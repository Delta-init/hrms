import { Loan } from "../models/Loan.js";
import { Employee } from "../models/Employee.js";
import { DeductionRemovalRequest } from "../models/DeductionRemovalRequest.js";
import { Payslip } from "../models/Payslip.js";
import type {
  CreateLoanInput, UpdateLoanInput, PlanMonthInput, DirectPaymentInput,
} from "../validations/loanValidation.js";
import type { PaginationQuery, ILoan } from "../types/index.js";
import { addMonths, project, round2, takeFor } from "../utils/loanSchedule.js";
import { assertMonthEditable, isMonthEditable } from "./payrollBatchService.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { parsePagination } from "../utils/query.js";

interface LoanQuery extends PaginationQuery {
  employee?: string;
  status?: string;
}

const POP = [
  { path: "employee", select: "name employeeCode designation currency" },
  { path: "user", select: "name email" },
];

/**
 * Equal split of the principal across its instalments, rounded to the
 * currency's cents. This is the only place the figure is derived — nothing
 * else may set `monthlyDeduction` directly, so it can never drift from
 * `amount`/`installments` the way it used to when an edit changed one but not
 * the other.
 */
function computeMonthlyDeduction(amount: number, installments: number): number {
  return Math.round((amount / Math.max(1, installments)) * 100) / 100;
}

export class LoanService {
  async create(input: CreateLoanInput) {
    const employee = await Employee.findOne(scoped({ _id: input.employee }));
    if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });

    const installments = input.installments ?? 1;
    const monthlyDeduction = computeMonthlyDeduction(input.amount, installments);

    const doc = await Loan.create({
      organization: getOrgId(),
      employee: input.employee,
      user: employee.user ?? null,
      amount: input.amount,
      purpose: input.purpose,
      disbursedDate: input.disbursedDate ?? null,
      installments,
      monthlyDeduction,
      amountRepaid: 0,
      status: "active",
      notes: input.notes,
    });
    return Loan.findById(doc._id).populate(POP);
  }

  async list(query: LoanQuery) {
    const { page, limit, skip } = parsePagination(query, 20, 200);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.status) filter.status = query.status.includes(",") ? { $in: query.status.split(",") } : query.status;
    if (query.employee) filter.employee = query.employee;

    const sortable = new Set(["amount", "disbursedDate", "status", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "createdAt";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      Loan.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit),
      Loan.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await Loan.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Loan not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateLoanInput) {
    const record = await Loan.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Loan not found"), { statusCode: 404 });
    Object.assign(record, input);
    // Re-derived on every edit, not just when amount/installments are the
    // fields that changed — cheap, and it means this can never again fall out
    // of sync with the two numbers it's supposed to represent.
    record.monthlyDeduction = computeMonthlyDeduction(record.amount, record.installments);
    // Auto-close once fully repaid (unless explicitly cancelled).
    if (record.status !== "cancelled") {
      record.status = record.amountRepaid >= record.amount ? "closed" : "active";
    }
    await record.save();
    return Loan.findById(id).populate(POP);
  }

  async remove(id: string) {
    const record = await Loan.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Loan not found"), { statusCode: 404 });
  }

  /** Every month of the loan: what was taken, how, and what is still to come. */
  async history(id: string) {
    const loan = await Loan.findOne(scoped({ _id: id })).populate(POP);
    if (!loan) throw Object.assign(new Error("Loan not found"), { statusCode: 404 });
    return buildHistory(loan);
  }

  /** The signed-in employee's own loans and advances, each with its history. Read-only. */
  async listMine(userId: string) {
    const emp = await Employee.findOne(scoped({ user: userId })).select("_id").lean();
    if (!emp) return [];
    const loans = await Loan.find(scoped({ employee: emp._id, status: { $ne: "cancelled" } }))
      .populate(POP)
      .sort({ status: 1, disbursedDate: -1, createdAt: -1 });
    return Promise.all(loans.map((l) => buildHistory(l, { forEmployee: true })));
  }

  /**
   * Skip a month (amount 0) or take less in it. The monthly instalment stays
   * as it is, so whatever the month does not take is picked up at the end of
   * the loan. Only for a month whose payslip is not final: a draft for the
   * month is recalculated on the spot, so it never shows the old figure.
   */
  async planMonth(id: string, month: string, input: PlanMonthInput, actorId: string) {
    const loan = await this.changeableMonth(id, month);
    const instalment = loan.monthlyDeduction || loan.amount;
    if (input.amount > 0 && input.amount >= instalment) {
      throw httpError(`To take less, enter an amount below the monthly ${fmt(instalment)} — or 0 to skip the month`, 400);
    }
    const slip = await this.draftFor(loan, month);

    loan.monthPlans = [
      ...(loan.monthPlans ?? []).filter((p) => p.month !== month),
      { month, amount: round2(input.amount), reason: input.reason?.trim() || undefined, by: actorId as never, at: new Date() },
    ].sort((a, b) => a.month.localeCompare(b.month)) as never;
    await loan.save();

    if (slip) await recalculateDraft(String(slip._id), actorId);
    return this.history(id);
  }

  /** Put a month back on the normal schedule. */
  async clearMonth(id: string, month: string, actorId: string) {
    const loan = await this.changeableMonth(id, month, { closedToo: true });
    if (!(loan.monthPlans ?? []).some((p) => p.month === month)) {
      throw httpError(`${monthName(month)} is already on the normal schedule`, 404);
    }
    const slip = await this.draftFor(loan, month);
    loan.monthPlans = (loan.monthPlans ?? []).filter((p) => p.month !== month) as never;
    await loan.save();
    if (slip) await recalculateDraft(String(slip._id), actorId);
    return this.history(id);
  }

  /**
   * Money paid back outside payroll. It comes off what is owed, like a
   * payslip's recovery; the instalment stays the same, so the loan simply
   * finishes sooner. Closes the loan when it clears it.
   */
  async addDirectPayment(id: string, input: DirectPaymentInput, actorId: string) {
    const loan = await Loan.findOne(scoped({ _id: id }));
    if (!loan) throw httpError("Loan not found", 404);
    if (loan.status === "cancelled") throw httpError("This loan is cancelled — nothing is owed on it", 400);

    const outstanding = round2(loan.amount - loan.amountRepaid);
    if (outstanding <= 0) throw httpError("Nothing is left to pay on this loan", 400);
    const amount = round2(input.amount);
    if (amount > outstanding) throw httpError(`Only ${fmt(outstanding)} is left to pay`, 400);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    if (input.date > endOfToday) throw httpError("The payment date can't be in the future", 400);

    loan.directPayments = [
      ...(loan.directPayments ?? []),
      {
        amount, date: input.date, method: input.method,
        reference: input.reference?.trim() || undefined, note: input.note?.trim() || undefined,
        by: actorId, at: new Date(),
      },
    ] as never;
    loan.amountRepaid = Math.min(loan.amount, round2(loan.amountRepaid + amount));
    if (loan.amountRepaid >= loan.amount) loan.status = "closed";
    await loan.save();
    return this.history(id);
  }

  /** Remove a direct payment entered by mistake; what it paid is owed again. */
  async removeDirectPayment(id: string, paymentId: string) {
    const loan = await Loan.findOne(scoped({ _id: id }));
    if (!loan) throw httpError("Loan not found", 404);
    const payment = (loan.directPayments ?? []).find((p) => String(p._id) === paymentId);
    if (!payment) throw httpError("Payment not found", 404);

    loan.directPayments = (loan.directPayments ?? []).filter((p) => String(p._id) !== paymentId) as never;
    loan.amountRepaid = Math.max(0, round2(loan.amountRepaid - payment.amount));
    if (loan.status === "closed" && loan.amountRepaid < loan.amount) loan.status = "active";
    await loan.save();
    return this.history(id);
  }

  /** The loan, when `month` is one HR may still change. */
  private async changeableMonth(id: string, month: string, opts: { closedToo?: boolean } = {}) {
    const loan = await Loan.findOne(scoped({ _id: id }));
    if (!loan) throw httpError("Loan not found", 404);
    if (loan.status === "cancelled") throw httpError("This loan is cancelled — nothing is taken from salary", 400);
    if (loan.status === "closed" && !opts.closedToo) throw httpError("This loan is fully repaid — nothing more is taken from salary", 400);
    const start = startMonthOf(loan);
    if (!start) throw httpError("Set the loan's start date first — nothing is taken from salary until it has one", 400);
    if (month < start) throw httpError(`This loan starts in ${monthName(start)}`, 400);
    await assertMonthEditable(month, "a loan's month");
    return loan;
  }

  /** The month's draft payslip, if there is one; refused when the payslip is final. */
  private async draftFor(loan: ILoan, month: string) {
    const slip = await Payslip.findOne(scoped({ employee: loan.employee, month })).select("status imported").lean<{ _id: unknown; status: string; imported?: unknown } | null>();
    if (!slip) return null;
    if (slip.imported) throw httpError(`${monthName(month)}'s payslip was imported from the salary sheet — its loan figure is the sheet's`, 409);
    if (slip.status !== "draft") throw httpError(`${monthName(month)}'s payslip is already ${slip.status} — pick a month that hasn't been paid`, 409);
    return slip;
  }
}

const httpError = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** "YYYY-MM" of the loan's first instalment — the month it was paid out. */
function startMonthOf(loan: { disbursedDate?: Date | null }): string | null {
  if (!loan.disbursedDate) return null;
  const d = new Date(loan.disbursedDate);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM" of the calendar month a date falls in. */
const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Re-run a draft payslip so it takes what the loan's plan now says — the way
 * a loss-of-pay override does: through update(), keeping the lines somebody
 * typed and working out the rest afresh. Imported lazily: payslipService
 * imports this module.
 */
async function recalculateDraft(payslipId: string, actorId: string) {
  const { PayslipService } = await import("./payslipService.js");
  const slip = await Payslip.findById(payslipId).select("deductions").lean<{ deductions: Array<{ label: string; amount: number }> } | null>();
  if (!slip) return;
  const deductions = slip.deductions.map((l) => ({ label: l.label, amount: l.amount }));
  await new PayslipService().update(payslipId, { deductions } as never, actorId);
}

export type LoanHistoryKind =
  | "opening"    // repaid before the payslips on record (or set by hand)
  | "salary"     // one instalment from the payslip
  | "partial"    // HR set a smaller amount for the month
  | "skipped"    // HR skipped the month
  | "waived"     // an approved deduction-removal request skipped it
  | "short"      // the pay could not cover the whole instalment
  | "none"       // a month with nothing taken (no payslip, or nothing on it)
  | "direct"     // paid back outside payroll
  | "correction" // the balance was set back by hand
  | "upcoming";  // still to come

export interface LoanHistoryRow {
  kind: LoanHistoryKind;
  month: string | null;
  /** What the schedule (or HR's plan) wanted that month. */
  planned: number;
  /** Taken, paid, or — for an upcoming month — to be taken. */
  amount: number;
  /** Left to pay after this row. */
  balance: number;
  payslipStatus?: string | null;
  imported?: boolean;
  plan?: { amount: number; reason?: string; at?: Date } | null;
  payment?: { id: string; date: Date; method: string; reference?: string; note?: string } | null;
  /** HR may still skip or change this month. */
  changeable?: boolean;
}

/**
 * The loan's months from the records that moved its balance: each payslip's
 * recovery, the months HR skipped or reduced, approved waivers, payments made
 * directly — and, after the last payslip, the schedule still to come.
 *
 * Whatever the records do not explain (repaid before HRMS had payslips, or a
 * balance set by hand) is one opening or correction row, so the rows always
 * add up to the balance the loan actually shows.
 */
export async function buildHistory(loan: ILoan, opts: { forEmployee?: boolean } = {}) {
  const loanId = String(loan._id);
  const employeeId = (loan.employee as { _id?: unknown })?._id ?? loan.employee;
  const instalment = round2(loan.monthlyDeduction || loan.amount);
  const start = startMonthOf(loan);
  const plans = new Map((loan.monthPlans ?? []).map((p) => [p.month, p]));

  const [slips, waivers] = await Promise.all([
    Payslip.find(scoped({ employee: employeeId })).select("month status imported recoveries deferred").sort({ month: 1 })
      .lean<Array<{ month: string; status: string; imported?: unknown; recoveries?: Array<{ kind: string; ref: unknown; amount: number }>; deferred?: number }>>(),
    DeductionRemovalRequest.find(scoped({ sourceType: "loan", sourceId: loan._id, status: "approved" })).select("month").lean(),
  ]);
  const waived = new Set(waivers.map((w) => w.month));

  const takenIn = (slip: (typeof slips)[number]) =>
    round2((slip.recoveries ?? []).filter((r) => r.kind === "loan" && String(r.ref) === loanId).reduce((n, r) => n + r.amount, 0));
  const bySlip = new Map(slips.map((s) => [s.month, s]));
  const tookAny = slips.filter((s) => takenIn(s) > 0);

  const directs = [...(loan.directPayments ?? [])].sort((a, b) => +new Date(a.date) - +new Date(b.date));
  const viaPayroll = round2(tookAny.reduce((n, s) => n + takenIn(s), 0));
  const viaDirect = round2(directs.reduce((n, p) => n + p.amount, 0));
  const unexplained = round2(loan.amountRepaid - viaPayroll - viaDirect);

  let balance = round2(loan.amount - Math.max(0, unexplained));

  // Months on record: from the first payslip HRMS holds (or the loan's start,
  // if later) to the last — the months before that are the opening row.
  const firstSlip = slips[0]?.month;
  const lastSlip = slips[slips.length - 1]?.month;
  let from = start && firstSlip ? (start > firstSlip ? start : firstSlip) : tookAny[0]?.month;
  if (from && tookAny[0] && tookAny[0].month < from) from = tookAny[0].month;

  type PastRow = LoanHistoryRow & { key: string };
  const monthRows: PastRow[] = [];
  if (from && lastSlip) {
    for (let m = from; m <= lastSlip; m = addMonths(m, 1)) {
      const slip = bySlip.get(m);
      const taken = slip ? takenIn(slip) : 0;
      const plan = plans.get(m) ?? null;
      const live = start !== null && m >= start;
      if (taken <= 0 && !live) continue;
      monthRows.push({
        key: `${m}a`, month: m, kind: "none", planned: 0, amount: taken, balance: 0,
        payslipStatus: slip?.status ?? null, imported: !!slip?.imported,
        plan: plan ? { amount: plan.amount, reason: plan.reason, at: plan.at } : null,
      });
    }
  }
  const directRows: PastRow[] = directs.map((p) => ({
    key: `${monthOf(new Date(p.date))}b${new Date(p.date).toISOString()}`,
    month: monthOf(new Date(p.date)), kind: "direct", planned: 0, amount: round2(p.amount), balance: 0,
    payment: { id: String(p._id), date: p.date, method: p.method, reference: p.reference, note: p.note },
  }));

  const rows: LoanHistoryRow[] = [];
  if (unexplained > 0.005) {
    rows.push({ kind: "opening", month: null, planned: 0, amount: unexplained, balance });
  }
  for (const r of [...monthRows, ...directRows].sort((a, b) => a.key.localeCompare(b.key))) {
    const { key: _key, ...row } = r;
    if (row.kind === "direct") {
      balance = round2(balance - row.amount);
      rows.push({ ...row, balance });
      continue;
    }
    // Once the loan is clear, later payslips have nothing to explain.
    if (balance <= 0 && row.amount <= 0) continue;
    const m = row.month!;
    const plan = row.plan;
    // The normal instalment, and what this month was actually meant to take.
    row.planned = takeFor(balance, instalment);
    const want = takeFor(balance, instalment, plan ? plan.amount : null);
    if (row.amount > 0) {
      row.kind = plan && plan.amount > 0 ? "partial" : row.amount < want - 0.005 ? "short" : "salary";
    } else if (plan && plan.amount === 0) row.kind = "skipped";
    else if (waived.has(m)) row.kind = "waived";
    else if (row.payslipStatus && (bySlip.get(m)?.deferred ?? 0) > 0) row.kind = "short";
    else row.kind = "none";
    balance = round2(balance - row.amount);
    rows.push({ ...row, balance });
  }
  if (unexplained < -0.005) {
    balance = round2(balance - unexplained);
    rows.push({ kind: "correction", month: null, planned: 0, amount: round2(-unexplained), balance });
  }

  // What is still to come. A month whose payslip has not been made yet still
  // takes its instalment when it is, so the schedule picks up after the last
  // payslip — never earlier than last month, for someone with none lately.
  const outstanding = round2(loan.amount - loan.amountRepaid);
  const lastMonth = addMonths(monthOf(new Date()), -1);
  let next = lastSlip ? addMonths(lastSlip, 1) : lastMonth;
  if (next < lastMonth) next = lastMonth;
  if (start && start > next) next = start;
  const upcoming =
    loan.status === "active" && start && outstanding > 0
      ? project(outstanding, instalment, next, new Map([
          ...[...waived].map((m) => [m, 0] as const),
          ...[...plans.values()].map((p) => [p.month, p.amount] as const),
        ]))
      : [];
  let left = outstanding;
  for (const u of upcoming) {
    left = round2(left - u.take);
    const plan = plans.get(u.month) ?? null;
    rows.push({
      kind: "upcoming", month: u.month,
      planned: takeFor(left + u.take, instalment), amount: u.take, balance: left,
      plan: plan ? { amount: plan.amount, reason: plan.reason, at: plan.at } : waived.has(u.month) ? { amount: 0, reason: "Waived (approved request)" } : null,
    });
  }

  // Which months HR may still change: those with no final payslip, in a
  // payroll month that is still open.
  if (!opts.forEmployee && loan.status !== "cancelled") {
    const open = new Map<string, boolean>();
    for (const row of rows) {
      if (!row.month || row.kind === "direct" || row.kind === "opening" || row.kind === "correction") continue;
      if (row.kind !== "upcoming" && (row.payslipStatus !== "draft" || row.imported)) continue;
      if (!open.has(row.month)) open.set(row.month, await isMonthEditable(row.month));
      row.changeable = open.get(row.month)!;
    }
  }

  // The employee sees only issued and paid payslips, so a month still on a
  // draft is, to them, still to come — though the loan has counted it.
  let pending = 0;
  if (opts.forEmployee) {
    for (const row of rows) {
      if (row.kind === "direct" || row.kind === "upcoming" || row.payslipStatus !== "draft") continue;
      pending = round2(pending + row.amount);
      Object.assign(row, { kind: "upcoming", payslipStatus: null });
    }
  }

  const toCome = rows.filter((r) => r.kind === "upcoming" && r.amount > 0);
  return {
    loan,
    summary: {
      amount: loan.amount,
      instalment,
      repaid: round2(loan.amountRepaid - pending),
      outstanding: round2(outstanding + pending),
      viaPayroll: round2(viaPayroll - pending),
      viaDirect,
      before: Math.max(0, unexplained),
      startMonth: start,
      monthsLeft: toCome.length,
      endMonth: toCome.length ? toCome[toCome.length - 1].month : null,
      next: toCome[0] ? { month: toCome[0].month!, amount: toCome[0].amount } : null,
      skippedMonths: rows.filter((r) => r.kind === "skipped" || (r.kind === "upcoming" && r.plan?.amount === 0)).length,
    },
    rows,
  };
}

export interface LoanDeductionLine {
  label: string;
  amount: number;
}
interface Repayment {
  loanId: string;
  amount: number;
}

/** Months from the loan's first instalment to `month`, inclusive — 0 before it starts. */
function instalmentsDueBy(disbursedDate: Date | undefined | null, month: string): number {
  if (!disbursedDate) return 0;
  const d = new Date(disbursedDate);
  const [y, m] = month.split("-").map(Number);
  return (y - d.getFullYear()) * 12 + (m - (d.getMonth() + 1)) + 1;
}

/**
 * What an employee's active loans should recover in `month`: one instalment,
 * or what is left when that is less.
 *
 * Never the months before it as well. It used to be the whole schedule to date
 * minus what had been repaid, so a missed month was made up the next — but a
 * month is "missed" just as much when its payroll was run outside HRMS, and the
 * visa loans dated 3 September all took two instalments from October's salary
 * (one dated July would have taken all four). The user: "only take that month
 * only". A month that collects nothing, or too little, now moves the end of the
 * loan back instead of doubling the next payslip. Still capped at the
 * outstanding balance, and the caller caps it again at what the payslip can
 * actually afford.
 */
export async function computeLoanDeductions(
  employeeId: string,
  month: string
): Promise<{ lines: LoanDeductionLine[]; repayments: Repayment[]; waived: LoanDeductionLine[] }> {
  const loans = await Loan.find(scoped({ employee: employeeId, status: "active" }));
  const lines: LoanDeductionLine[] = [];
  const repayments: Repayment[] = [];
  const waived: LoanDeductionLine[] = [];

  // Approved-for-this-month removals, if any — a handful of rows at most, so
  // one query up front beats one per loan.
  const removals = loans.length
    ? await DeductionRemovalRequest.find(
        scoped({ employee: employeeId, month, sourceType: "loan", sourceId: { $in: loans.map((l) => l._id) }, status: "approved" })
      ).select("sourceId").lean()
    : [];
  const waivedLoanIds = new Set(removals.map((r) => String(r.sourceId)));

  for (const loan of loans) {
    const outstanding = round2(loan.amount - loan.amountRepaid);
    if (outstanding <= 0) continue;

    const elapsed = instalmentsDueBy(loan.disbursedDate, month);
    if (elapsed <= 0) continue;
    const schedule = loan.monthlyDeduction || loan.amount;
    // HR may have skipped this month or set a smaller amount for it. With no
    // plan, one instalment — the last one takes the remainder, so an amount
    // that does not divide evenly (1000 over 3 months, 333.33 each) closes on
    // schedule rather than leaving a stray month to collect the last cent.
    const plan = (loan.monthPlans ?? []).find((p) => p.month === month);
    const want = takeFor(outstanding, schedule, plan ? plan.amount : null);

    const label = loan.kind === "advance"
      ? SALARY_ADVANCE_LABEL
      : `${LOAN_DEDUCTION_PREFIX}${loan.purpose ? ` (${loan.purpose})` : ""}`;

    // Waived: nothing is collected, and no repayment is recorded — the loan
    // simply runs a month longer, as it does when pay could not cover the
    // instalment. A zero-amount line still appears, so the payslip explains
    // the absence rather than leaving a collected instalment quietly missing.
    if (waivedLoanIds.has(String(loan._id))) {
      waived.push({ label: `${label} — waived (approved request)`, amount: 0 });
      continue;
    }
    // Skipped by HR: the same as a waiver — nothing taken, the loan ends a
    // month later — and the payslip says so.
    if (plan && plan.amount <= 0) {
      waived.push({ label: `${label} — skipped this month`, amount: 0 });
      continue;
    }
    if (want <= 0) continue;

    lines.push({ label, amount: want });
    repayments.push({ loanId: String(loan._id), amount: want });
  }
  return { lines, repayments, waived };
}

/** Apply the recorded repayments to the loans; close any that are fully repaid. */
export async function recordLoanRepayments(repayments: Repayment[]): Promise<void> {
  for (const r of repayments) {
    const loan = await Loan.findById(r.loanId);
    if (!loan) continue;
    loan.amountRepaid = Math.min(loan.amount, round2(loan.amountRepaid + r.amount));
    if (loan.amountRepaid >= loan.amount) loan.status = "closed";
    await loan.save();
  }
}

/**
 * Undo repayments a payslip recorded, for when it is edited or deleted.
 *
 * Without this, correcting a payslip left the money counted as collected: the
 * balance fell, the loan could even close, and nothing had actually been paid.
 */
export async function reverseLoanRepayments(repayments: Repayment[]): Promise<void> {
  for (const r of repayments) {
    const loan = await Loan.findById(r.loanId);
    if (!loan) continue;
    loan.amountRepaid = Math.max(0, round2(loan.amountRepaid - r.amount));
    if (loan.amountRepaid < loan.amount && loan.status === "closed") loan.status = "active";
    await loan.save();
  }
}

/** Label prefix used for auto-generated loan deduction lines. */
export const LOAN_DEDUCTION_PREFIX = "Loan repayment";

/**
 * The line a salary advance's recovery prints as. Also the plain line an
 * imported salary sheet's SALARY ADVANCE column falls back to, so every
 * reader can sum the column by this one prefix.
 */
export const SALARY_ADVANCE_LABEL = "Salary advance";

/** Lines the payslip derives from loans and advances itself, never typed in. */
export const isRecoveryLine = (label: string) =>
  label.startsWith(LOAN_DEDUCTION_PREFIX) || label.startsWith(SALARY_ADVANCE_LABEL);
