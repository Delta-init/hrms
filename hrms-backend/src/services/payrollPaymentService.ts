import { PayrollBatch } from "../models/PayrollBatch.js";
import { Payslip } from "../models/Payslip.js";
import { payrollBatchService } from "./payrollBatchService.js";
import { scoped } from "../utils/orgContext.js";
import type { PayrollBatchStatus } from "../types/index.js";

/**
 * The last step: accounts telling HRMS that money has actually left the bank.
 *
 * This is the only path by which a payslip becomes "paid". HR cannot set it,
 * and nothing in this codebase infers it — a payslip says paid because a
 * transfer happened, and the system that made the transfer said so.
 *
 * Everything here is built around one fact: the caller cannot tell a timeout
 * from a failure. It has already moved the money by the time it calls, so a
 * refusal it did not expect is worse than a duplicate it can recognise. Hence
 * the payment id, and hence a repeat returning the original answer rather than
 * an error.
 */

const err = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

/** A payment may only land on a month accounts have signed off. */
const PAYABLE_FROM: PayrollBatchStatus[] = ["approved", "partially_paid"];

export interface PaymentLine {
  payslipId: string;
  amount: number;
}

export class PayrollPaymentService {
  /**
   * Record that some or all of a month has been paid.
   *
   * Partial by design. A run where one new joiner has no IBAN should pay the
   * other fifty-nine, so the caller names the payslips it actually transferred
   * and the month lands on `partially_paid` until none are left.
   */
  async record(
    month: string,
    input: {
      paymentId: string;
      paidOn?: string;
      reference?: string;
      method?: string;
      lines: PaymentLine[];
    }
  ) {
    const batch = await PayrollBatch.findOne(scoped({ month }));
    if (!batch) throw err(`No payroll batch for ${month}`, 404);

    // Idempotency first, before any validation that could reject a retry of a
    // payment that already succeeded. A caller re-sending after a lost response
    // must get the original answer, not an argument about batch status.
    const seen = batch.payments.find((p) => p.paymentId === input.paymentId);
    if (seen) {
      return {
        duplicate: true,
        message: `Payment ${input.paymentId} was already recorded`,
        month,
        status: batch.status,
        paidCount: seen.payslipCount,
        batch: await payrollBatchService.describe(month),
      };
    }

    if (!PAYABLE_FROM.includes(batch.status)) {
      throw err(
        batch.status === "paid"
          ? `${month} is already fully paid`
          : `${month} is ${batch.status.replace("_", " ")}; approve it before recording a payment`,
        409
      );
    }
    if (!input.lines.length) throw err("No payslips were named in this payment", 400);

    const ids = input.lines.map((l) => l.payslipId);
    const slips = await Payslip.find(scoped({ _id: { $in: ids }, month })).select("_id status");
    if (slips.length !== ids.length) {
      throw err("Some of those payslips do not belong to this month", 409);
    }

    const paidOn = input.paidOn ? new Date(input.paidOn) : new Date();
    if (Number.isNaN(paidOn.getTime())) throw err("paidOn is not a valid date", 400);

    // Already-paid slips are skipped rather than refused. A payment covering a
    // person who was settled separately is an overlap to ignore, not a reason
    // to reject a transfer that has already happened.
    const toPay = slips.filter((s) => s.status !== "paid").map((s) => String(s._id));

    if (toPay.length) {
      await Payslip.updateMany(
        scoped({ _id: { $in: toPay } }),
        { $set: { status: "paid", paidAt: paidOn } }
      );
    }

    const outstanding = await Payslip.countDocuments(scoped({ month, status: { $ne: "paid" } }));
    const nextStatus: PayrollBatchStatus = outstanding === 0 ? "paid" : "partially_paid";

    batch.payments.push({
      paymentId: input.paymentId,
      paidOn,
      reference: input.reference ?? "",
      method: input.method ?? "",
      payslipCount: toPay.length,
      amount: input.lines.reduce((a, l) => a + (l.amount || 0), 0),
      recordedAt: new Date(),
    } as never);
    await batch.save();

    if (batch.status !== nextStatus) {
      await payrollBatchService.transition(month, nextStatus, {
        actor: "finance",
        note: `Payment ${input.paymentId}${input.reference ? ` (${input.reference})` : ""}`,
      });
    }

    return {
      duplicate: false,
      message: `${toPay.length} payslip(s) marked paid`,
      month,
      status: nextStatus,
      paidCount: toPay.length,
      skipped: slips.length - toPay.length,
      outstanding,
      batch: await payrollBatchService.describe(month),
    };
  }

  /**
   * Undo a payment, when a transfer bounced.
   *
   * Finance-driven, because the money moved on their side and only they know it
   * came back. The payslips return to issued rather than draft: they were
   * correct, they simply were not paid, and dropping them to draft would put
   * them back in HR's editing pile on a month accounts still hold.
   */
  async reverse(month: string, paymentId: string, reason: string) {
    const batch = await PayrollBatch.findOne(scoped({ month }));
    if (!batch) throw err(`No payroll batch for ${month}`, 404);

    const index = batch.payments.findIndex((p) => p.paymentId === paymentId);
    if (index === -1) throw err(`No payment ${paymentId} on ${month}`, 404);

    const payment = batch.payments[index]!;
    // Only the slips this payment settled, found by the timestamp it stamped
    // on them: another payment on the same month must not be undone with it.
    const affected = await Payslip.find(scoped({ month, status: "paid", paidAt: payment.paidOn }))
      .select("_id")
      .lean();

    await Payslip.updateMany(
      scoped({ _id: { $in: affected.map((s) => s._id) } }),
      { $set: { status: "issued", paidAt: null } }
    );

    batch.payments.splice(index, 1);
    await batch.save();

    const outstanding = await Payslip.countDocuments(scoped({ month, status: { $ne: "paid" } }));
    const paidAny = await Payslip.countDocuments(scoped({ month, status: "paid" }));
    const nextStatus: PayrollBatchStatus =
      outstanding === 0 ? "paid" : paidAny > 0 ? "partially_paid" : "approved";

    // Straight assignment: the state machine forbids paid → approved, and
    // rightly so for anything a person does. A bounced transfer is the one case
    // where the fact on the ground moved backwards, and refusing to record that
    // would leave a payslip claiming money that was returned.
    batch.status = nextStatus;
    batch.paidAt = nextStatus === "paid" ? batch.paidAt : null;
    batch.history.push({
      from: "paid", to: nextStatus, at: new Date(), by: null,
      actor: "finance", note: `Reversed payment ${paymentId}: ${reason}`,
    } as never);
    await batch.save();

    return {
      message: `Payment ${paymentId} reversed; ${affected.length} payslip(s) returned to issued`,
      month,
      status: nextStatus,
      reversed: affected.length,
      batch: await payrollBatchService.describe(month),
    };
  }
}

export const payrollPaymentService = new PayrollPaymentService();
