import { Payslip } from "../models/Payslip.js";
import { Employee } from "../models/Employee.js";
import { Attendance } from "../models/Attendance.js";
import { Holiday } from "../models/Holiday.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import type { CreatePayslipInput, UpdatePayslipInput } from "../validations/payslipValidation.js";
import type { PaginationQuery, IEmployee } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { assertMonthEditable } from "./payrollBatchService.js";
import {
  computeLoanDeductions, recordLoanRepayments, reverseLoanRepayments, LOAN_DEDUCTION_PREFIX,
} from "./loanService.js";
import { computeOneTimeAdjustments, markOneTimeApplied, recordAdjustmentRecoveries, reverseAdjustmentRecoveries, releaseOneTimePayments } from "./oneTimeAdjustmentService.js";
import { OneTimeAdjustment } from "../models/OneTimeAdjustment.js";
import { computeReimbursements, markReimbursementsPaid, releaseReimbursements } from "./reimbursementService.js";
import { computeOvertime, markOvertimeApplied, releaseOvertime } from "./overtimeService.js";
import { resolveSalaryBreakup } from "./salaryStructureService.js";
import { getAttendancePenaltyPolicy, computeLatePenaltyDays } from "./attendancePenaltyService.js";
import { zonedTimeToUtc, DEFAULT_WORK_DAYS } from "../utils/schedule.js";
import { STANDARD_MONTH_DAYS, dayValue, dailyRate } from "../utils/payMonth.js";
import { policiesForUser } from "./leavePolicyResolver.js";
import { employmentWindowFor, employmentWindows, employedOn, employedFraction, type EmploymentWindow } from "./employmentWindow.js";
import { parsePagination } from "../utils/query.js";

interface PayslipQuery extends PaginationQuery {
  employee?: string;
  month?: string;
}

const POP = [
  { path: "employee", select: "name employeeCode designation department salary currency" },
  { path: "issuedBy", select: "name email" },
];

function monthBounds(month: string) {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

/** Month bounds as local-midnight-UTC in the given timezone. */
function monthBoundsTz(month: string, tz: string) {
  const [y, m] = month.split("-").map(Number);
  const nm = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { start: zonedTimeToUtc(`${month}-01`, "00:00", tz), end: zonedTimeToUtc(`${nm}-01`, "00:00", tz) };
}


interface Line { label: string; amount: number }
/** The slice of a work schedule payroll reads. */
interface ScheduleShape {
  timeZone?: string;
  workDays?: number[];
}
interface Recovery { kind: "loan" | "adjustment"; ref: unknown; amount: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

export const LOP_PREFIX = "Loss of Pay";
export const PENALTY_PREFIX = "Late Penalty";
const isAttendanceLine = (label: string) => label.startsWith(LOP_PREFIX) || label.startsWith(PENALTY_PREFIX);

/** Local calendar day of an instant, as YYYY-MM-DD. */
function dayKey(date: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date));
}

/** Every local day a leave request covers, clipped to the month. */
function dayRange(from: Date, to: Date, start: Date, end: Date, tz: string): string[] {
  const a = new Date(Math.max(new Date(from).getTime(), start.getTime()));
  const b = new Date(Math.min(new Date(to).getTime(), end.getTime() - 1));
  const keys: string[] = [];
  const cur = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()));
  const last = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
  while (cur <= last) { keys.push(dayKey(cur, tz)); cur.setUTCDate(cur.getUTCDate() + 1); }
  return keys;
}

/**
 * The month's working days as YYYY-MM-DD keys.
 *
 * Without a schedule this falls back to the same default leave uses, rather
 * than counting every calendar day. Treating Sundays as working days inflated
 * the month and made the two disagree about the same person.
 */
function workingDayKeys(month: string, workDays?: number[], employment?: EmploymentWindow): string[] {
  const days = workDays?.length ? workDays : DEFAULT_WORK_DAYS;
  const [y, m] = month.split("-").map(Number);
  const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const keys: string[] = [];
  for (let d = 1; d <= total; d++) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (!days.includes(dt.getUTCDay())) continue;
    const key = dt.toISOString().slice(0, 10);
    // Days either side of somebody's employment are not theirs to work. A
    // joiner mid-month owed attendance for the whole month before this.
    if (employment && !employedOn(employment, key)) continue;
    keys.push(key);
  }
  return keys;
}

/** Days in `month` that fall on the schedule's working weekdays. */
function countWorkingDays(month: string, workDays?: number[], employment?: EmploymentWindow): number {
  return workingDayKeys(month, workDays, employment).length;
}

/**
 * Loss of pay and late penalties, priced off a 30-day month.
 *
 * Thirty is a convention, not a count: it makes a day off cost the same in
 * February as in July. Pricing by the month's own length, or by its working
 * days, moved the value of one absent day around by up to a tenth with nothing
 * on the payslip to explain why.
 *
 * `salary` is contractual pay, deliberately not the gross. A day away costs a
 * day of salary; reimbursements and overtime paid in the same month are not
 * part of that, and counting them let a taxi claim raise the price of absence.
 */
function attendanceDeductions(
  summary: { lopDays: number; latePenaltyDays: number },
  salary: number,
  /**
   * The most this month can lose — the payable gross, which is smaller than
   * `salary` for a joiner or a leaver. A day is still priced against the full
   * monthly salary; you simply cannot be docked more than you were owed. Without
   * this a three-day leaver came out at minus ten fils, because the month was
   * prorated over its own 31 days while a day off costs a flat thirtieth.
   */
  cap: number = salary
): Line[] {
  if (salary <= 0) return [];
  // Unrounded, and each total rounded once. Rounding the rate first turned
  // 100/30 into 3.33, so seven days cost 23.31 where the day counts said 23.33
  // — two fils, but enough that a payslip would not reconcile against its own
  // figures, and the residue on a part month read as an arbitrary number.
  const perDay = dayValue(salary);
  const lines: Line[] = [];
  if (summary.lopDays > 0) lines.push({ label: `${LOP_PREFIX} (${summary.lopDays}d)`, amount: r2(perDay * summary.lopDays) });
  if (summary.latePenaltyDays > 0) lines.push({ label: `${PENALTY_PREFIX} (${summary.latePenaltyDays}d)`, amount: r2(perDay * summary.latePenaltyDays) });

  // Rounding the daily rate can still overshoot by pennies across a whole month.
  const total = lines.reduce((a, l) => a + l.amount, 0);
  if (total > cap && total > 0) {
    const scale = cap / total;
    for (const l of lines) l.amount = r2(l.amount * scale);
  }
  return lines;
}

/**
 * Fit the recoverable deductions into what the month can actually pay.
 *
 * Take-home is never allowed below zero. Anything scheduled that the pay can't
 * cover is simply not taken this month — one-time deductions keep their unpaid
 * remainder, and loans re-derive theirs from the schedule — so it comes off the
 * next payslip that has room. Previously the full instalment was deducted
 * regardless, producing a negative net pay and recording money as collected
 * that nobody had paid.
 *
 * Order matters: hand-entered lines (loss of pay, penalties) come off first
 * because they are reductions in earnings rather than debts and can't be
 * deferred. One-time items are recovered before loans — they are usually the
 * shorter-lived of the two.
 */
function allocateRecoveries(
  earnings: Line[],
  manualDeductions: Line[],
  adjustments: Array<Line & { adjustmentId: string }>,
  loanLines: Line[],
  repayments: Array<{ loanId: string; amount: number }>
): { lines: Line[]; recoveries: Recovery[]; deferred: number; taken: Array<{ kind: "loan" | "adjustment"; id: string; amount: number }> } {
  const gross = r2(earnings.reduce((a, l) => a + (l.amount || 0), 0));
  const manual = r2(manualDeductions.reduce((a, l) => a + (l.amount || 0), 0));

  if (manual > gross) {
    throw Object.assign(
      new Error(
        `Deductions of ${r2(manual)} exceed earnings of ${gross}. Reduce them — only loans and one-time deductions can be carried to next month.`
      ),
      { statusCode: 400 }
    );
  }

  let available = r2(gross - manual);
  const lines: Line[] = [];
  const recoveries: Recovery[] = [];
  const taken: Array<{ kind: "loan" | "adjustment"; id: string; amount: number }> = [];
  let deferred = 0;

  const consume = (kind: "loan" | "adjustment", id: string, label: string, want: number) => {
    const amount = r2(Math.min(want, available));
    if (amount > 0) {
      available = r2(available - amount);
      lines.push({ label, amount });
      recoveries.push({ kind, ref: id, amount });
      taken.push({ kind, id, amount });
    }
    deferred = r2(deferred + (want - amount));
  };

  for (const a of adjustments) consume("adjustment", a.adjustmentId, a.label, a.amount);
  loanLines.forEach((line, i) => {
    const id = repayments[i]?.loanId;
    if (id) consume("loan", id, line.label, line.amount);
  });

  return { lines, recoveries, deferred, taken };
}

/**
 * The employees a payroll run for `month` should cover.
 *
 * Everybody still on the books, plus anybody who left during the month. A
 * leaver's last month was falling through entirely: the run skipped every
 * terminated employee, and the full-and-final settlement on their resignation
 * pays gratuity, leave encashment and dues but never salary — so their final
 * month had no automatic path at all and someone had to remember to raise it by
 * hand. Nothing is paid twice: finalising a settlement consumes the
 * reimbursements, one-time items and loans it settles.
 *
 * A leaver is only included for months their employment actually touched, and
 * only when a last working day is on record. Without one there is no end to
 * their window, and they would come back in every run for ever.
 */
async function payrollRosterFilter(month: string): Promise<Record<string, unknown>> {
  const left = await Employee.find(scoped({ status: "terminated" })).select("_id joiningDate").lean();
  if (!left.length) return { status: { $ne: "terminated" } };

  const windows = await employmentWindows(left as never);
  const stillOwed = left
    .filter((e) => {
      const w = windows.get(String(e._id));
      return !!w?.to && employedFraction(w, month) > 0;
    })
    .map((e) => e._id);

  if (!stillOwed.length) return { status: { $ne: "terminated" } };
  return { $or: [{ status: { $ne: "terminated" } }, { _id: { $in: stillOwed } }] };
}

/** Credit the loans and one-time items with what the payslip actually took. */
async function applyRecoveries(
  alloc: { taken: Array<{ kind: "loan" | "adjustment"; id: string; amount: number }> },
  payslipId: string
) {
  const loans = alloc.taken.filter((t) => t.kind === "loan").map((t) => ({ loanId: t.id, amount: t.amount }));
  const adjustments = alloc.taken.filter((t) => t.kind === "adjustment").map((t) => ({ adjustmentId: t.id, amount: t.amount }));
  if (loans.length) await recordLoanRepayments(loans);
  if (adjustments.length) await recordAdjustmentRecoveries(adjustments, payslipId);
}

/** Hand back everything a payslip collected, before editing or deleting it. */
async function undoRecoveries(record: { _id?: unknown; recoveries?: Array<{ kind: string; ref: unknown; amount: number }> }) {
  const rows = record.recoveries ?? [];
  const loans = rows.filter((r) => r.kind === "loan").map((r) => ({ loanId: String(r.ref), amount: r.amount }));
  const adjustments = rows.filter((r) => r.kind === "adjustment").map((r) => ({ adjustmentId: String(r.ref), amount: r.amount }));
  if (loans.length) await reverseLoanRepayments(loans);
  if (adjustments.length) await reverseAdjustmentRecoveries(adjustments);

  // Reimbursements and overtime record which payslip paid them, so that link is
  // what gets undone. Left alone, a claim stayed paid against a payslip that no
  // longer existed and could never be claimed again.
  if (record._id) {
    await releaseReimbursements(String(record._id));
    await releaseOvertime(String(record._id));
    // A one-time payment is paid, never recovered, so it is not in recoveries
    // and needs releasing by payslip like the other two.
    await releaseOneTimePayments(String(record._id));
  }
}

export class PayslipService {
  async create(input: CreatePayslipInput, issuerId: string) {
    // Refused once the month is with accounts: a new payslip appearing after
    // the handover is money finance never saw.
    await assertMonthEditable(input.month, "payslips");
    const emp = await Employee.findOne(scoped({ _id: input.employee }));
    if (!emp) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });

    const existing = await Payslip.findOne(scoped({ employee: input.employee, month: input.month }));
    if (existing) throw Object.assign(new Error("A payslip already exists for this employee and month"), { statusCode: 409 });

    // Auto-derived lines are recomputed here rather than trusted from the form,
    // so a stale prefill can never double-count.
    const { lines: loanLines, repayments } = await computeLoanDeductions(input.employee, input.month);
    const userDeductions = (input.deductions ?? []).filter((d) => !d.label.startsWith(LOAN_DEDUCTION_PREFIX));
    // One-time payments (earnings) and deductions still owed for this month.
    const oneTime = await computeOneTimeAdjustments(input.employee, input.month);
    // Approved expense reimbursements paid out this month (earnings).
    const reimb = await computeReimbursements(input.employee, input.month);
    // Overtime worked, paid out this month (earnings).
    const ot = await computeOvertime(input.employee, input.month);
    const earnings = [...(input.earnings ?? []), ...oneTime.earnings, ...reimb.earnings, ...ot.earnings];

    // Attendance applies itself, like loans and reimbursements do. Any lines the
    // form sent are dropped first so a stale prefill can't double them.
    // Loss of pay is a proportion of contractual salary — the resolved breakup,
    // not whatever sits in the earnings boxes. A bonus typed in for the month
    // was raising the price of a day off, and basing it on the breakup is also
    // what the payroll run and the salary register do, so all four paths now
    // put the same number on the screen.
    const att = await this.summary(input.employee, input.month);
    const attLines = attendanceDeductions(att, att.salary, att.proratedGross);
    const manual = [...userDeductions.filter((d) => !isAttendanceLine(d.label)), ...attLines];

    const alloc = allocateRecoveries(earnings, manual, oneTime.deductions, loanLines, repayments);
    const deductions = [...manual, ...alloc.lines];

    const { start } = monthBounds(input.month);
    const doc = new Payslip({
      ...input,
      earnings,
      deductions,
      // The attendance basis, stored rather than left inside a line label so
      // the figures can be checked and recomputed later.
      workingDays: input.workingDays ?? att.workingDays,
      paidDays: input.paidDays ?? att.paidDays,
      lopDays: input.lopDays ?? att.lopDays,
      recoveries: alloc.recoveries,
      deferred: alloc.deferred,
      organization: getOrgId(),
      monthDate: start,
      user: emp.user ?? null,
      currency: input.currency || emp.currency || "AED",
    });
    const status = input.status ?? "draft";
    doc.status = status;
    if (status === "issued" || status === "paid") { doc.issuedBy = issuerId as never; doc.issuedAt = new Date(); }
    if (status === "paid") doc.paidAt = new Date();
    await doc.save();

    // Credit only what the payslip could actually collect, now the slip exists.
    await applyRecoveries(alloc, String(doc._id));
    if (oneTime.ids.length) await markOneTimeApplied(oneTime.ids, String(doc._id));
    if (reimb.ids.length) await markReimbursementsPaid(reimb.ids, String(doc._id));
    if (ot.ids.length) await markOvertimeApplied(ot.ids, String(doc._id));
    return Payslip.findById(doc._id).populate(POP);
  }

  async list(query: PayslipQuery) {
    const { page, limit, skip } = parsePagination(query, 20, 200);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.employee) filter.employee = query.employee;
    if (query.month) filter.month = query.month;
    if (query.status) filter.status = query.status;

    const sortable = new Set(["month", "netPay", "grossPay", "status", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "month";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      Payslip.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit).lean(),
      Payslip.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async listMine(userId: string, query: PayslipQuery) {
    const { page, limit, skip } = parsePagination(query, 20, 200);
    const filter: Record<string, unknown> = { user: userId, status: { $in: ["issued", "paid"] } };
    if (query.month) filter.month = query.month;
    const [records, total] = await Promise.all([
      Payslip.find(filter).populate(POP).sort({ month: -1 }).skip(skip).limit(limit).lean(),
      Payslip.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await Payslip.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Payslip not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdatePayslipInput, actorId: string) {
    const record = await Payslip.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Payslip not found"), { statusCode: 404 });

    // Both months are checked: editing a locked slip is refused, and so is
    // moving an editable one into a month that has already gone to accounts.
    await assertMonthEditable(record.month, "a payslip");
    if (input.month !== undefined && input.month !== record.month) {
      await assertMonthEditable(input.month, "a payslip");
    }

    if (input.month !== undefined) { record.month = input.month; record.monthDate = monthBounds(input.month).start; }
    if (input.currency !== undefined) record.currency = input.currency;
    // Earnings or deductions changing means the recoverable amount changes too.
    // Hand back everything this slip collected and re-run the allocation, or the
    // loan balance drifts from what was actually paid — an edit used to leave the
    // original repayment credited on top of the new one.
    if (input.earnings !== undefined || input.deductions !== undefined) {
      await undoRecoveries(record);

      const month = input.month ?? record.month;
      const employeeId = String(record.employee);
      const earnings = (input.earnings ?? record.earnings) as unknown as Line[];
      const typed = ((input.deductions ?? record.deductions) as unknown as Line[])
        .filter((d) => !d.label.startsWith(LOAN_DEDUCTION_PREFIX) && !isAttendanceLine(d.label));

      const att = await this.summary(employeeId, month);
      const manual = [...typed, ...attendanceDeductions(att, att.salary, att.proratedGross)];

      const { lines: loanLines, repayments } = await computeLoanDeductions(employeeId, month);
      const oneTime = await computeOneTimeAdjustments(employeeId, month);
      const alloc = allocateRecoveries(earnings, manual, oneTime.deductions, loanLines, repayments);

      record.earnings = earnings as never;
      record.deductions = [...manual, ...alloc.lines] as never;
      record.workingDays = att.workingDays;
      record.paidDays = att.paidDays;
      record.lopDays = att.lopDays;
      record.recoveries = alloc.recoveries as never;
      record.deferred = alloc.deferred;
      await applyRecoveries(alloc, String(record._id));
    }
    if (input.workingDays !== undefined) record.workingDays = input.workingDays;
    if (input.paidDays !== undefined) record.paidDays = input.paidDays;
    if (input.lopDays !== undefined) record.lopDays = input.lopDays;
    if (input.notes !== undefined) record.notes = input.notes ?? undefined;

    if (input.status !== undefined && input.status !== record.status) {
      record.status = input.status;
      if ((input.status === "issued" || input.status === "paid") && !record.issuedAt) {
        record.issuedBy = actorId as never;
        record.issuedAt = new Date();
      }
      if (input.status === "paid") record.paidAt = new Date();
    }

    await record.save();
    return Payslip.findById(id).populate(POP);
  }

  /**
   * Move a selection of payslips to one status. Only the status moves — the
   * amounts and everything recovered against them are left alone, so this is
   * safe to run over a whole month at once.
   *
   * "paid" is deliberately not on offer. Marking somebody paid is a statement
   * that money left a bank account, and that happens in the accounts system —
   * it arrives here over the integration, at the end of the handover. Letting
   * HR set it directly would make the whole three-step flow optional, and the
   * first sign of trouble would be a payslip saying paid with nothing sent.
   */
  async bulkSetStatus(ids: string[], status: "draft" | "issued") {
    const records = await Payslip.find(scoped({ _id: { $in: ids } })).select("month").lean();
    for (const month of new Set(records.map((r) => r.month))) {
      await assertMonthEditable(month, "payslip statuses");
    }
    const result = await Payslip.updateMany(scoped({ _id: { $in: ids } }), { $set: { status } });
    return { message: `${result.modifiedCount} payslip(s) marked ${status}`, matched: result.matchedCount, modified: result.modifiedCount };
  }

  /**
   * Delete a selection, returning each to "not generated".
   *
   * One at a time rather than deleteMany: every slip has to hand back what it
   * collected against loans and adjustments first, and that is per-record work.
   */
  async bulkRemove(ids: string[]) {
    const records = await Payslip.find(scoped({ _id: { $in: ids } }));
    for (const month of new Set(records.map((r) => r.month))) {
      await assertMonthEditable(month, "payslips");
    }
    for (const record of records) {
      await undoRecoveries(record);
      await Payslip.deleteOne({ _id: record._id });
    }
    return { message: `${records.length} payslip(s) reverted to not generated`, deleted: records.length };
  }

  async remove(id: string) {
    const record = await Payslip.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Payslip not found"), { statusCode: 404 });
    await assertMonthEditable(record.month, "a payslip");
    // Deleting a payslip un-collects its recoveries; leaving them credited made
    // loans look repaid by a slip that no longer exists.
    await undoRecoveries(record);
    await Payslip.deleteOne({ _id: record._id });
    return { message: "Payslip deleted successfully" };
  }

  /** Attendance/leave summary for a month — used to prefill LOP + a Basic line. */
  async summary(employeeId: string, month: string) {
    const emp = await Employee.findOne(scoped({ _id: employeeId }))
      .populate({ path: "user", select: "workSchedule", populate: { path: "workSchedule", select: "timeZone workDays" } })
      .populate({ path: "workSchedule", select: "timeZone workDays" })
      .lean<IEmployee & {
        user?: { _id?: unknown; workSchedule?: ScheduleShape } | null;
        workSchedule?: ScheduleShape | null;
      }>();
    if (!emp) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
    // Named `employment`: `window` is a DOM global here and would type-check
    // against that instead of failing.
    const employment = await employmentWindowFor(emp as never);

    // Bound the month in the employee's timezone so local days at the month
    // edges bucket correctly (attendance is stored as local-midnight-UTC).
    // A schedule can hang off either record. It is set on the employee from the
    // employee form and on the user from the user form, and reading only the
    // latter meant a schedule assigned the obvious way was ignored — every
    // calendar day counted as a working day, weekends included.
    const schedule = emp.user?.workSchedule ?? emp.workSchedule ?? null;
    const tz = schedule?.timeZone || "Asia/Dubai";
    const workDays = schedule?.workDays;
    const { start, end } = monthBoundsTz(month, tz);

    // Active-loan instalments that will be deducted from this payslip.
    const { lines: loanDeductions } = await computeLoanDeductions(employeeId, month);
    // Salary breakup in force: a structure assignment if one exists, else a
    // single Basic = the salary from any effective-dated increment (resolved
    // internally by resolveSalaryBreakup, which also lets a later increment
    // override an assignment's frozen Basic). `salary` (the gross of all
    // earnings) is the LOP base.
    const breakup = await resolveSalaryBreakup(employeeId, month, emp.salary ?? 0);

    // A monthly salary buys a whole month. Somebody who joined on the 20th, or
    // left on the 8th, has not had one, and paying the full amount and then
    // docking the days they were absent could never reach the right figure —
    // loss of pay can only charge days inside their window, so a leaver kept
    // most of a month's pay for a week on the books. The contractual figures
    // are cut to the part of the month that was theirs.
    //
    // `salary` deliberately stays the full monthly gross: it is what a day is
    // priced against, and a missed day costs a full day whether or not the
    // month was a whole one.
    const employedShare = employedFraction(employment, month);
    const cut = (lines: Line[]) => lines.map((l) => ({ ...l, amount: r2(l.amount * employedShare) }));
    const earnings = employedShare < 1 ? cut(breakup.earnings) : breakup.earnings;
    const structureDeductions = employedShare < 1 ? cut(breakup.deductions) : breakup.deductions;

    // Lines the payslip will pick up on its own — reimbursements, overtime and
    // one-time items. Reported so the form can preview the figure it is going
    // to produce: without them it showed a net pay lower than the payslip it
    // then created, because the server adds these after the form is submitted.
    const [reimb, ot, oneTime] = await Promise.all([
      computeReimbursements(employeeId, month),
      computeOvertime(employeeId, month),
      computeOneTimeAdjustments(employeeId, month),
    ]);

    const base = {
      present: 0, late: 0, half: 0, absent: 0, unpaidLeaveDays: 0, lopDays: 0, latePenaltyDays: 0,
      /** Approved leave falling on working days — paid, and holidays likewise. */
      paidLeaveDays: 0, holidayDays: 0,
      salary: breakup.gross,
      earnings,
      structureDeductions,
      structureName: breakup.structureName,
      /** Contractual gross cut to the part of the month they were employed. */
      proratedGross: r2(earnings.reduce((t, l) => t + l.amount, 0)),
      /** 1 unless they joined or left mid-month. Reported so the form can say so. */
      employedShare,
      employment,
      currency: emp.currency ?? "AED", loanDeductions,
      // Read-only: the payslip re-derives all of these, so sending them back
      // with the form would count them twice.
      autoEarnings: [...oneTime.earnings, ...reimb.earnings, ...ot.earnings],
      autoDeductions: [...loanDeductions, ...oneTime.deductions.map((d) => ({ label: d.label, amount: d.amount }))],
      workingDays: 0,
      paidDays: 0,
      /** Days of salary this month is worth for them — 30, or their share of it. */
      salaryDays: 0,
      recordedDays: 0,
      unrecordedDays: 0,
      unrecordedFutureDays: 0,
      // Whether those days cost pay. The form warns very differently either way.
      unrecordedDaysUnpaid: false,
    };
    const userId = emp.user?._id ?? null;
    if (!userId) return base;

    const [att, unpaid, anyLeave, holidays] = await Promise.all([
      Attendance.find({ user: userId, date: { $gte: start, $lt: end } }).select("status date timeZone").lean(),
      LeaveRequest.find({ user: userId, status: "approved", startDate: { $lt: end }, endDate: { $gte: start } }).select("type days startDate endDate").lean(),
      // Any approved leave counts as accounted for, paid or not — the day is
      // explained, which is what the coverage check is asking about.
      LeaveRequest.find({ user: userId, status: "approved", startDate: { $lt: end }, endDate: { $gte: start } }).select("startDate endDate").lean(),
      Holiday.find({ ...orgFilter(), date: { $gte: start, $lt: end } }).select("date").lean(),
    ]);

    // Build day-level sets so a day that is both absent and on unpaid leave
    // counts once (LOP is not double-counted).
    const lopFull = new Set<string>();
    const halfSet = new Set<string>();
    for (const a of att) {
      // Local calendar day of the record, aligned with leave's YYYY-MM-DD.
      const key = new Intl.DateTimeFormat("en-CA", { timeZone: a.timeZone || tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(a.date));
      if (a.status === "present") base.present++;
      else if (a.status === "late") base.late++;
      else if (a.status === "half_day") { base.half++; halfSet.add(key); }
      else if (a.status === "absent") { base.absent++; lopFull.add(key); }
    }
    // Which leave types cost pay is the policy's decision, not the type name:
    // an organization may run casual leave paid or unpaid. Falls back to the
    // literal "unpaid" type where nothing is configured yet.
    const policies = await policiesForUser(userId);
    const paidByType = new Map(policies.map((p) => [p.type, p.paid]));
    const isUnpaidLeave = (type: string) =>
      paidByType.size ? paidByType.get(type) === false : type === "unpaid";

    const unpaidLeave = unpaid.filter((l) => isUnpaidLeave(l.type));
    for (const l of unpaidLeave) {
      for (const k of dayRange(l.startDate, l.endDate, start, end, tz)) lopFull.add(k);
    }
    base.unpaidLeaveDays = unpaidLeave.reduce((s, l) => s + (l.days || 0), 0);

    // Paid leave and non-working days never cost pay, so they are removed before
    // counting: only a working day the employee was neither present for nor
    // excused from reduces the salary.
    const paidLeaveDays = new Set<string>();
    for (const l of unpaid) {
      if (isUnpaidLeave(l.type)) continue;
      for (const k of dayRange(l.startDate, l.endDate, start, end, tz)) paidLeaveDays.add(k);
    }
    const holidayDays = new Set(holidays.map((h) => dayKey(h.date, tz)));
    const workingSet = new Set(workingDayKeys(month, workDays, employment));
    const chargeable = (k: string) => workingSet.has(k) && !paidLeaveDays.has(k) && !holidayDays.has(k);
    // Only the working days of it — leave spanning a weekend is not two days
    // off work — so the figure sits beside "present" and "half day" and adds up.
    base.paidLeaveDays = [...paidLeaveDays].filter((k) => workingSet.has(k)).length;
    base.holidayDays = [...holidayDays].filter((k) => workingSet.has(k)).length;

    let halfCount = 0;
    for (const k of halfSet) if (!lopFull.has(k) && chargeable(k)) halfCount++;
    base.lopDays = Math.round(([...lopFull].filter(chargeable).length + halfCount * 0.5) * 100) / 100;

    // Repeated lateness beyond the org's configured grace converts into a
    // separate half-day-equivalent deduction (kept apart from absence-driven LOP).
    const penaltyPolicy = await getAttendancePenaltyPolicy();
    base.latePenaltyDays = computeLatePenaltyDays(base.late, penaltyPolicy);

    // Working days come from the schedule's week pattern; without one every day
    // of the month counts, which is the honest answer when nobody has said
    // which days this person is expected to work.
    base.workingDays = countWorkingDays(month, workDays, employment);

    // Working days nothing accounts for — no attendance, no approved leave, no
    // holiday. A payslip is only as good as its attendance coverage, and one
    // record in a 31-day month should not read the same as a full one.
    const accounted = new Set<string>();
    for (const a of att) accounted.add(dayKey(a.date, a.timeZone || tz));
    for (const h of holidays) accounted.add(dayKey(h.date, tz));
    for (const l of anyLeave) for (const k of dayRange(l.startDate, l.endDate, start, end, tz)) accounted.add(k);

    const workingKeys = workingDayKeys(month, workDays, employment);
    const unrecordedKeys = workingKeys.filter((k) => !accounted.has(k));
    base.unrecordedDays = unrecordedKeys.length;
    base.recordedDays = workingKeys.length - base.unrecordedDays;

    // The whole month counts, days still to come included: a payslip covers the
    // month, and a day nobody ever marks is a day nobody worked. Generating
    // mid-month therefore prices the month as it stands — every remaining day
    // unaccounted for — so the figure is only final once the month is. Split
    // out rather than hidden, so the form can say which part has not happened.
    const today = dayKey(new Date(), tz);
    base.unrecordedFutureDays = unrecordedKeys.filter((k) => k >= today).length;

    // Only docked when the organization has said attendance is mandatory.
    base.unrecordedDaysUnpaid = penaltyPolicy.unrecordedDaysUnpaid;
    if (penaltyPolicy.unrecordedDaysUnpaid && base.unrecordedDays > 0) {
      base.lopDays = Math.round((base.lopDays + base.unrecordedDays) * 100) / 100;
    }

    // Counted against the thirty days the salary buys, not against the working
    // days alone. Rest days and holidays are paid — nothing ever docks them —
    // so leaving them out of the count made it disagree with the money beside
    // it: somebody on 100 taking home 25 read as "paid days 3.5 of 26", which
    // works out at 13.46. Against thirty it reads 7.5, which is the 25.
    base.salaryDays = r2(employedShare * STANDARD_MONTH_DAYS);
    base.paidDays = Math.max(0, r2(base.salaryDays - base.lopDays));

    // Everything the payslip will deduct on its own, now the attendance figures
    // are final. The form has no rows for these — they are derived on create —
    // so without them the preview quietly under-reported the deductions and
    // promised a net pay the payslip was never going to produce.
    base.autoDeductions = [
      ...attendanceDeductions(base, base.salary, base.proratedGross),
      ...loanDeductions,
      ...oneTime.deductions.map((d) => ({ label: d.label, amount: d.amount })),
    ];
    return base;
  }

  /**
   * Monthly payroll preview: for every active employee, auto-compute base pay,
   * attendance-driven Loss of Pay, loan instalments and net — plus whether a
   * payslip already exists for the month. Uses the same math as a single
   * payslip (base = salary, LOP per-day = salary/30, loans from active loans).
   */
  async runPreview(month: string) {
    const employees = await Employee.find(scoped(await payrollRosterFilter(month)))
      .select("name employeeCode salary currency user")
      .sort({ name: 1 });
    // The whole payslip, not just its status: once one exists it is the record
    // of what was paid, and the row has to show that rather than a fresh guess.
    const existing = await Payslip.find(scoped({ month }));
    const existMap = new Map(existing.map((p) => [String(p.employee), p]));

    // What each existing payslip actually paid as a one-time payment. Read back
    // from the adjustments it consumed, because by now they are marked applied
    // and recomputing returns nothing — which is what folded a bonus silently
    // into "base salary" and emptied the add-ons column.
    const paidOneTime = new Map<string, number>();
    if (existing.length) {
      const ids = existing.map((p) => p._id);
      const consumed = await OneTimeAdjustment.find({
        // Rows written before the id was cast properly hold a string.
        payslip: { $in: [...ids, ...ids.map(String)] as never[] },
        kind: "payment",
      }).select("payslip appliedAmount amount").lean();
      for (const a of consumed) {
        const key = String(a.payslip);
        paidOneTime.set(key, r2((paidOneTime.get(key) ?? 0) + (a.appliedAmount ?? a.amount ?? 0)));
      }
    }

    const round = (n: number) => Math.round(n * 100) / 100;
    const rows = [];
    for (const emp of employees) {
      const s = await this.summary(String(emp._id), month);
      // Two different numbers, and the row needs both. `base` is the
      // contractual monthly gross, which prices a day off. `payable` is what
      // this month actually owes — the same figure cut to a joiner's or
      // leaver's part of the month, so the row and the payslip agree.
      const base = s.salary || 0;
      const payable = s.proratedGross ?? base;
      // Same helper the payslip uses, so the preview row and the generated
      // payslip cannot disagree about what a day is worth.
      const attLines = attendanceDeductions(s, base, payable);
      const lopAmount = round(attLines.find((l) => l.label.startsWith(LOP_PREFIX))?.amount ?? 0);
      // Sent rather than re-derived on the client: the row should quote the
      // rate the deduction was actually priced at, not one worked backwards
      // from a rounded total.
      const lopPerDay = dailyRate(base);
      const latePenaltyAmount = round(attLines.find((l) => l.label.startsWith(PENALTY_PREFIX))?.amount ?? 0);
      const loanTotal = round((s.loanDeductions ?? []).reduce((a, l) => a + l.amount, 0));
      const structureDeductions = round((s.structureDeductions ?? []).reduce((a, l) => a + l.amount, 0));
      const oneTime = await computeOneTimeAdjustments(String(emp._id), month);
      const oneTimePayments = round(oneTime.earnings.reduce((a, l) => a + l.amount, 0));
      const oneTimeDeductions = round(oneTime.deductions.reduce((a, l) => a + l.amount, 0));
      const reimb = await computeReimbursements(String(emp._id), month);
      const reimbursements = round(reimb.earnings.reduce((a, l) => a + l.amount, 0));
      const ot = await computeOvertime(String(emp._id), month);
      const overtime = round(ot.earnings.reduce((a, l) => a + l.amount, 0));
      const totalDeductions = round(lopAmount + latePenaltyAmount + loanTotal + structureDeductions + oneTimeDeductions);
      const slip = existMap.get(String(emp._id));

      // A generated payslip is the truth. Recomputing the row from today's data
      // meant the list and the payslip disagreed the moment anything moved —
      // a loan instalment read 99.94 in the table and 100.06 on the payslip,
      // because the table was re-running an allocation the payslip had already
      // settled. Where a payslip exists, its own figures are reported.
      const sum = (lines: Array<{ label: string; amount: number }>, match: (l: string) => boolean) =>
        round(lines.filter((l) => match(l.label)).reduce((a, l) => a + l.amount, 0));

      // For a generated payslip these come from the slip, not from a fresh
      // computation: the adjustments it consumed are closed, so recomputing
      // reports zero for work the payslip plainly did.
      const slipOneTimePayments = slip ? (paidOneTime.get(String(slip._id)) ?? 0) : oneTimePayments;
      const slipOneTimeDeductions = slip
        ? round((slip.recoveries ?? []).filter((r) => r.kind === "adjustment").reduce((a, r) => a + r.amount, 0))
        : oneTimeDeductions;

      const row = slip
        ? {
            // Everything that is not a reimbursement, overtime or a one-time
            // payment — those have columns of their own.
            salary: round(
              sum(slip.earnings, (l) => !l.startsWith("Reimbursement") && !l.startsWith("Overtime")) - slipOneTimePayments
            ),
            earnings: slip.earnings,
            lopAmount: sum(slip.deductions, (l) => l.startsWith(LOP_PREFIX)),
            latePenaltyAmount: sum(slip.deductions, (l) => l.startsWith(PENALTY_PREFIX)),
            loanTotal: sum(slip.deductions, (l) => l.startsWith(LOAN_DEDUCTION_PREFIX)),
            reimbursements: sum(slip.earnings, (l) => l.startsWith("Reimbursement")),
            overtime: sum(slip.earnings, (l) => l.startsWith("Overtime")),
            totalDeductions: round(slip.totalDeductions),
            netPay: round(slip.netPay),
          }
        : {
            salary: payable,
            earnings: s.earnings ?? [{ label: "Basic", amount: payable }],
            lopAmount,
            latePenaltyAmount,
            loanTotal,
            reimbursements,
            overtime,
            totalDeductions,
            netPay: round(payable + oneTimePayments + reimbursements + overtime - totalDeductions),
          };

      rows.push({
        employee: { _id: emp._id, name: emp.name, employeeCode: emp.employeeCode },
        currency: s.currency,
        structureName: s.structureName ?? null,
        structureDeductions: s.structureDeductions ?? [],
        lopDays: slip ? (slip.lopDays ?? s.lopDays) : s.lopDays,
        // Reported so the row can say what the lost days are out of. A bare
        // count gave no clue whether it was calendar days or working ones.
        workingDays: slip ? (slip.workingDays || s.workingDays) : s.workingDays,
        latePenaltyDays: s.latePenaltyDays,
        lopPerDay,
        oneTimePayments: slipOneTimePayments,
        oneTimeDeductions: slipOneTimeDeductions,
        ...row,
        payslipId: slip ? String(slip._id) : null,
        status: slip?.status ?? null, // null → not generated yet
      });
    }
    return { month, rows };
  }

  /**
   * Salary register for a month: every active employee's fully itemised pay
   * (earnings + deductions + gross/net) plus bank details, and org-level totals.
   * The basis for the register report + a generic bank-transfer CSV. Not a
   * substitute for the UAE Central Bank / MoHRE Salary Information File (SIF)
   * format WPS actually requires — see SalaryRegister.tsx.
   */
  async salaryRegister(month: string) {
    const employees = await Employee.find(scoped(await payrollRosterFilter(month)))
      .select("name employeeCode designation salary currency user bank")
      .sort({ name: 1 })
      .lean();
    const round = (n: number) => Math.round(n * 100) / 100;

    const rows = [];
    let tGross = 0, tDed = 0, tNet = 0;
    for (const emp of employees) {
      const s = await this.summary(String(emp._id), month);
      const oneTime = await computeOneTimeAdjustments(String(emp._id), month);
      const reimb = await computeReimbursements(String(emp._id), month);
      const ot = await computeOvertime(String(emp._id), month);

      const earnings = [...(s.earnings ?? [{ label: "Basic", amount: s.salary || 0 }]), ...oneTime.earnings, ...reimb.earnings, ...ot.earnings];
      const deductions: { label: string; amount: number }[] = [...(s.structureDeductions ?? [])];
      deductions.push(...attendanceDeductions(s, s.salary || 0, s.proratedGross));
      for (const l of s.loanDeductions ?? []) deductions.push(l);
      deductions.push(...oneTime.deductions);

      const gross = round(earnings.reduce((a, e) => a + e.amount, 0));
      const totalDeductions = round(deductions.reduce((a, d) => a + d.amount, 0));
      const net = round(gross - totalDeductions);
      tGross += gross; tDed += totalDeductions; tNet += net;

      const bank = (emp as { bank?: { ibanIfsc?: string; bankName?: string; nameInBank?: string; bankAccountNumber?: string } }).bank;
      rows.push({
        employee: { _id: emp._id, name: emp.name, employeeCode: emp.employeeCode, designation: emp.designation },
        currency: s.currency,
        bank: {
          iban: bank?.ibanIfsc ?? "",
          accountNumber: bank?.bankAccountNumber ?? "",
          bankName: bank?.bankName ?? "",
          nameInBank: bank?.nameInBank ?? "",
        },
        earnings,
        deductions,
        structureName: s.structureName ?? null,
        gross,
        totalDeductions,
        net,
      });
    }
    return {
      month,
      currency: rows[0]?.currency ?? "AED",
      rows,
      totals: { gross: round(tGross), deductions: round(tDed), net: round(tNet), count: rows.length },
    };
  }

  /** Bulk-create draft payslips for every active employee lacking one this month. */
  async runGenerate(month: string, issuerId: string) {
    await assertMonthEditable(month, "payslips");
    const employees = await Employee.find(scoped(await payrollRosterFilter(month))).select("_id salary");
    const existing = await Payslip.find(scoped({ month })).select("employee");
    const existSet = new Set(existing.map((p) => String(p.employee)));

    let created = 0;
    let skipped = 0;
    for (const emp of employees) {
      if (existSet.has(String(emp._id))) { skipped++; continue; }
      const s = await this.summary(String(emp._id), month);
      // Earnings from the salary structure (Basic + allowances), else a single Basic.
      const earnings = s.earnings ?? [{ label: "Basic", amount: s.salary || 0 }];
      // Recurring structure deductions only. Attendance, loans and one-time
      // items are all derived by create(), which strips anything sent here to
      // avoid counting them twice — so there is nothing to gain by seeding them.
      const deductions: { label: string; amount: number }[] = [...(s.structureDeductions ?? [])];
      await this.create({ employee: String(emp._id), month, currency: s.currency, earnings, deductions, status: "draft" } as never, issuerId);
      created++;
    }
    return { month, created, skipped, total: employees.length };
  }
}
