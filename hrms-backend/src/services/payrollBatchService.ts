import { PayrollBatch } from "../models/PayrollBatch.js";
import { Payslip } from "../models/Payslip.js";
import { Employee } from "../models/Employee.js";
import { Organization } from "../models/Organization.js";
import { scoped, getOrgId } from "../utils/orgContext.js";
import type { PayrollBatchStatus } from "../types/index.js";
import { stillHere } from "../utils/employeeStatus.js";
import { totalsByCurrency, type CurrencyTotals } from "../utils/payrollTotals.js";
import { PayrollMute } from "../models/PayrollMute.js";

/**
 * The month's payroll as a unit, and the lock that stops HR editing it once
 * accounts have it.
 *
 * Imports models only, never other services. `payslipService` and
 * `oneTimeAdjustmentService` both call `assertMonthEditable` here, so a
 * dependency the other way would be a cycle.
 */

/**
 * Statuses in which the month's payslips may still be changed.
 *
 * Everything else is frozen. The reason is not tidiness: once finance has
 * imported the figures, an edit here means the money that leaves the bank and
 * the payslip the employee downloads describe two different months, and nothing
 * downstream would notice.
 */
const EDITABLE: PayrollBatchStatus[] = ["draft", "returned"];

/** Which moves are legal, and therefore which are refused. */
const TRANSITIONS: Record<PayrollBatchStatus, PayrollBatchStatus[]> = {
  draft: ["submitted"],
  // Recall is only possible while finance has not picked it up yet.
  submitted: ["in_finance", "draft", "returned"],
  in_finance: ["approved", "returned"],
  approved: ["partially_paid", "paid", "returned"],
  partially_paid: ["partially_paid", "paid"],
  // Terminal for now. Reversing a payment is a later phase and needs finance to
  // drive it, because the money moved on their side.
  paid: [],
  returned: ["submitted", "draft"],
};

const err = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

function monthStart(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 1));
}

/**
 * The organisation's own currency, if it has said what it is.
 *
 * It decides which currency a month's single headline figure is in. Null when
 * unset, in which case the largest group of payslips decides instead — see
 * `totalsByCurrency`.
 */
async function orgCurrency(): Promise<string | null> {
  const orgId = getOrgId();
  if (!orgId) return null;
  const org = await Organization.findById(orgId)
    .select("settings.currency")
    .lean<{ settings?: { currency?: string } } | null>();
  return org?.settings?.currency?.trim().toUpperCase() || null;
}

export interface BatchView {
  month: string;
  status: PayrollBatchStatus;
  exists: boolean;
  editable: boolean;
  /** The headline currency: what `employeeCount` and the three totals are in. */
  currency: string;
  employeeCount: number;
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
  /** Every currency in the month, the headline first. Sum these for the full headcount. */
  byCurrency: CurrencyTotals[];
  submittedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  returnedAt: string | null;
  returnReason: string;
  financeRunId: string;
  history: Array<{ from: string; to: string; at: string; actor: string; note?: string }>;
}

export class PayrollBatchService {
  /**
   * The batch for a month, real or implied.
   *
   * A month with no row is a draft month rather than an error — the row is
   * created on submit, so every month before its first handover has to answer
   * this without one existing.
   */
  async describe(month: string): Promise<BatchView> {
    const batch = await PayrollBatch.findOne(scoped({ month })).lean();
    const status: PayrollBatchStatus = batch?.status ?? "draft";
    const editable = EDITABLE.includes(status);

    /**
     * Which figures to show.
     *
     * While HR can still change payslips the stored ones are stale by
     * definition — they are whatever the last submission recorded, and a month
     * that was submitted and recalled kept them — so an editable month is read
     * live. Once it is with accounts the snapshot is the point: it is what they
     * were handed, and it has to stay legible after a later correction.
     */
    let byCurrency: CurrencyTotals[];
    if (editable) {
      const [slips, preferred] = await Promise.all([
        Payslip.find(scoped({ month })).select("currency grossPay totalDeductions netPay").lean(),
        orgCurrency(),
      ]);
      byCurrency = totalsByCurrency(slips, batch?.currency ?? preferred ?? "AED", preferred);
    } else if (batch?.byCurrency?.length) {
      byCurrency = batch.byCurrency.map((r) => ({
        currency: r.currency, employeeCount: r.employeeCount, grossTotal: r.grossTotal,
        deductionTotal: r.deductionTotal, netTotal: r.netTotal,
      }));
    } else if (batch) {
      // Submitted before there was a breakdown: all that exists is the old single
      // figure, so that is what is shown, under the currency it was recorded in.
      byCurrency = [{
        currency: batch.currency ?? "AED", employeeCount: batch.employeeCount ?? 0,
        grossTotal: batch.grossTotal ?? 0, deductionTotal: batch.deductionTotal ?? 0, netTotal: batch.netTotal ?? 0,
      }];
    } else {
      byCurrency = [];
    }
    const head = byCurrency[0];

    return {
      month,
      status,
      exists: Boolean(batch),
      editable,
      currency: head?.currency ?? batch?.currency ?? "AED",
      employeeCount: head?.employeeCount ?? 0,
      grossTotal: head?.grossTotal ?? 0,
      deductionTotal: head?.deductionTotal ?? 0,
      netTotal: head?.netTotal ?? 0,
      byCurrency,
      submittedAt: batch?.submittedAt ? new Date(batch.submittedAt).toISOString() : null,
      approvedAt: batch?.approvedAt ? new Date(batch.approvedAt).toISOString() : null,
      paidAt: batch?.paidAt ? new Date(batch.paidAt).toISOString() : null,
      returnedAt: batch?.returnedAt ? new Date(batch.returnedAt).toISOString() : null,
      returnReason: batch?.returnReason ?? "",
      financeRunId: batch?.financeRunId ?? "",
      history: (batch?.history ?? []).map((h) => ({
        from: h.from, to: h.to, at: new Date(h.at).toISOString(), actor: h.actor, note: h.note,
      })),
    };
  }

  /**
   * Everything that would stop this month being handed over, and everything
   * worth knowing before it is.
   *
   * The distinction matters: a blocker means the submit is refused, a warning
   * means it goes ahead and somebody has been told. Missing bank details are a
   * warning here rather than a blocker because finance can still take the run
   * and pay the rest — holding the whole month for one unbanked new joiner
   * would be worse than paying the other fifty-nine.
   */
  async preflight(month: string) {
    const [batch, slips, preferredCurrency] = await Promise.all([
      this.describe(month),
      Payslip.find(scoped({ month })).select("employee status netPay grossPay totalDeductions currency").lean(),
      orgCurrency(),
    ]);

    const blockers: string[] = [];
    const warnings: string[] = [];

    if (!batch.editable) {
      blockers.push(`This month is already with accounts (${batch.status.replace("_", " ")}).`);
    }
    if (slips.length === 0) {
      blockers.push("No payslips have been generated for this month yet.");
    }

    const negative = slips.filter((s) => (s.netPay ?? 0) < 0);
    if (negative.length) {
      blockers.push(`${negative.length} payslip(s) have a negative net pay. Nobody can be paid a negative salary.`);
    }

    const drafts = slips.filter((s) => s.status === "draft").length;
    if (drafts) {
      warnings.push(`${drafts} payslip(s) are still drafts. Submitting will issue them.`);
    }

    // Anyone with a payslip but no way to receive the money.
    const empIds = slips.map((s) => s.employee);
    const unbanked = await Employee.countDocuments(
      scoped({
        _id: { $in: empIds },
        $or: [
          { bank: { $exists: false } },
          { "bank.ibanIfsc": { $in: ["", null] }, "bank.bankAccountNumber": { $in: ["", null] } },
        ],
      })
    );
    if (unbanked) {
      warnings.push(`${unbanked} employee(s) have no bank details. Accounts will not be able to pay them.`);
    }

    // Somebody on the roster who never got a payslip is more often an oversight
    // than a decision, so it is said out loud rather than left to be noticed.
    // Muted people have no payslip on purpose — said, but not as a gap.
    const [active, muted] = await Promise.all([
      Employee.countDocuments(scoped({ status: stillHere() })),
      PayrollMute.countDocuments(scoped({ month })),
    ]);
    if (active - muted > slips.length) {
      warnings.push(`${active - muted - slips.length} active employee(s) have no payslip for this month.`);
    }
    if (muted) warnings.push(`${muted} employee(s) are muted for this month — no salary and nothing deducted.`);

    /**
     * One row per currency, never one sum.
     *
     * This used to add every payslip's net as a bare number — 81 in dirhams and
     * 22 in rupees — and the dialog printed the result under the batch's one
     * currency, so rupees were presented as dirhams and the figure that was
     * stored, and shown to accounts, was out by the whole rupee payroll. The
     * headline fields are the leading currency's alone; the rest is in
     * `byCurrency`. What is stored on submit comes from here, so the dialog HR
     * confirms and the record accounts reads cannot disagree.
     */
    const byCurrency = totalsByCurrency(slips, batch.currency, preferredCurrency);
    const head = byCurrency[0];

    return {
      month,
      status: batch.status,
      canSubmit: blockers.length === 0,
      blockers,
      warnings,
      totals: {
        currency: head?.currency ?? batch.currency,
        employeeCount: head?.employeeCount ?? 0,
        grossTotal: head?.grossTotal ?? 0,
        deductionTotal: head?.deductionTotal ?? 0,
        netTotal: head?.netTotal ?? 0,
        byCurrency,
      },
    };
  }

  /**
   * Hand the month to accounts.
   *
   * Issues any payslip still in draft on the way through, because "HR has
   * finished with this month" and "these payslips are final" are the same
   * statement, and leaving a draft behind would put an unfinished slip in front
   * of accounts as though it were settled.
   */
  async submit(month: string, userId: string) {
    const pre = await this.preflight(month);
    if (!pre.canSubmit) {
      throw err(pre.blockers.join(" "), 409);
    }

    await Payslip.updateMany(
      scoped({ month, status: "draft" }),
      { $set: { status: "issued", issuedBy: userId, issuedAt: new Date() } }
    );

    const existing = await PayrollBatch.findOne(scoped({ month }));
    const from: PayrollBatchStatus = existing?.status ?? "draft";
    this.assertTransition(from, "submitted");

    // The batch's currency is the headline one `preflight` already worked out.
    // It used to be the currency of whichever payslip the database returned
    // first — AED only because of the order, in a month with twenty-two rupee
    // payslips in it.
    const { currency, employeeCount, grossTotal, deductionTotal, netTotal, byCurrency } = pre.totals;

    const batch = await PayrollBatch.findOneAndUpdate(
      scoped({ month }),
      {
        $set: {
          organization: getOrgId(),
          monthDate: monthStart(month),
          currency,
          status: "submitted",
          submittedBy: userId,
          submittedAt: new Date(),
          // Cleared so a resubmission after a return does not still look
          // rejected to whoever reads it next.
          returnedAt: null,
          returnReason: "",
          // Named, not spread: the four figures are the headline currency's
          // alone, and a spread would quietly start storing whatever else
          // `totals` grows.
          employeeCount, grossTotal, deductionTotal, netTotal, byCurrency,
        },
        $push: { history: { from, to: "submitted", at: new Date(), by: userId, actor: "hr" } },
      },
      { upsert: true, new: true }
    );

    return { message: `Payroll for ${month} submitted to accounts`, batch: await this.describe(month), id: String(batch._id) };
  }

  /**
   * Pull the month back from accounts.
   *
   * Only while it is still merely submitted. Once finance has imported it they
   * may have added figures of their own, and yanking it out from under them
   * would strand those — from that point the way back is finance returning it.
   */
  async recall(month: string, userId: string) {
    const batch = await PayrollBatch.findOne(scoped({ month }));
    if (!batch) throw err("This month has not been submitted", 404);
    if (batch.status !== "submitted") {
      throw err(
        batch.status === "in_finance" || batch.status === "approved"
          ? "Accounts have already picked this month up. Ask them to send it back."
          : `A payroll that is ${batch.status.replace("_", " ")} cannot be recalled.`,
        409
      );
    }

    batch.status = "draft";
    batch.submittedAt = null;
    batch.history.push({ from: "submitted", to: "draft", at: new Date(), by: userId as never, actor: "hr" } as never);
    await batch.save();
    return { message: `Payroll for ${month} recalled`, batch: await this.describe(month) };
  }

  /** Refuses a move the state machine does not allow. */
  assertTransition(from: PayrollBatchStatus, to: PayrollBatchStatus) {
    if (from === to) return;
    if (!TRANSITIONS[from].includes(to)) {
      throw err(`A payroll that is ${from.replace("_", " ")} cannot move to ${to.replace("_", " ")}`, 409);
    }
  }

  /**
   * Applies a transition driven by the other system.
   *
   * Not routed yet — the finance-facing endpoints arrive with the payroll run
   * itself. It lives here now because the state machine belongs in one place,
   * and splitting it later would mean two sets of rules to keep in step.
   */
  async transition(
    month: string,
    to: PayrollBatchStatus,
    opts: { actor: string; note?: string; financeRunId?: string; userId?: string } = { actor: "finance" }
  ) {
    const batch = await PayrollBatch.findOne(scoped({ month }));
    if (!batch) throw err("No payroll batch for that month", 404);
    this.assertTransition(batch.status, to);

    const from = batch.status;
    batch.status = to;
    if (to === "approved") batch.approvedAt = new Date();
    if (to === "paid") batch.paidAt = new Date();
    if (to === "returned") {
      batch.returnedAt = new Date();
      batch.returnReason = opts.note ?? "";
    }
    if (opts.financeRunId) batch.financeRunId = opts.financeRunId;
    batch.history.push({
      from, to, at: new Date(), by: (opts.userId ?? null) as never, actor: opts.actor, note: opts.note,
    } as never);
    await batch.save();
    return this.describe(month);
  }

  /** Recent months, for a handover list. */
  async list(limit = 12) {
    const rows = await PayrollBatch.find(scoped({})).sort({ month: -1 }).limit(limit).lean();
    return rows.map((b) => ({
      month: b.month,
      status: b.status,
      currency: b.currency,
      employeeCount: b.employeeCount,
      netTotal: b.netTotal,
      submittedAt: b.submittedAt ? new Date(b.submittedAt).toISOString() : null,
      paidAt: b.paidAt ? new Date(b.paidAt).toISOString() : null,
    }));
  }
}

/**
 * The guard every write against a month's pay has to pass.
 *
 * Called from payslipService and oneTimeAdjustmentService rather than enforced
 * at the route, because the routes are not the only way in — a bulk operation,
 * a seed script or a future job all reach the same records, and a check that
 * only exists in middleware is a check that a later caller forgets.
 */
export async function assertMonthEditable(month: string | undefined | null, what = "payroll"): Promise<void> {
  if (!month) return;
  const batch = await PayrollBatch.findOne(scoped({ month })).select("status").lean();
  if (!batch) return;
  if (EDITABLE.includes(batch.status)) return;

  const where =
    batch.status === "submitted" ? "has been submitted to accounts"
    : batch.status === "in_finance" ? "is with accounts"
    : batch.status === "approved" ? "has been approved for payment"
    : batch.status === "partially_paid" ? "has been partly paid"
    : "has been paid";

  throw err(
    `Cannot change ${what} for ${month}: this month ${where}. Ask accounts to send it back if it needs a correction.`,
    409
  );
}

/** True when the month's pay may still be edited. */
export async function isMonthEditable(month: string): Promise<boolean> {
  const batch = await PayrollBatch.findOne(scoped({ month })).select("status").lean();
  return !batch || EDITABLE.includes(batch.status);
}

export const payrollBatchService = new PayrollBatchService();
