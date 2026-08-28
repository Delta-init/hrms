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
}

export const payrollPaymentService = new PayrollPaymentService();
