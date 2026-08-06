import { Payslip } from "../models/Payslip.js";
import { Employee } from "../models/Employee.js";
import { Attendance } from "../models/Attendance.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import type { CreatePayslipInput, UpdatePayslipInput } from "../validations/payslipValidation.js";
import type { PaginationQuery, IEmployee } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { computeLoanDeductions, recordLoanRepayments, LOAN_DEDUCTION_PREFIX } from "./loanService.js";
import { computeOneTimeAdjustments, markOneTimeApplied } from "./oneTimeAdjustmentService.js";
import { computeReimbursements, markReimbursementsPaid } from "./reimbursementService.js";
import { computeOvertime, markOvertimeApplied } from "./overtimeService.js";
import { resolveSalaryBreakup } from "./salaryStructureService.js";
import { getAttendancePenaltyPolicy, computeLatePenaltyDays } from "./attendancePenaltyService.js";
import { zonedTimeToUtc } from "../utils/schedule.js";
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

export class PayslipService {
  async create(input: CreatePayslipInput, issuerId: string) {
    const emp = await Employee.findOne(scoped({ _id: input.employee }));
    if (!emp) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });

    const existing = await Payslip.findOne(scoped({ employee: input.employee, month: input.month }));
    if (existing) throw Object.assign(new Error("A payslip already exists for this employee and month"), { statusCode: 409 });

    // Auto-apply this month's active-loan instalments as deduction lines. Any
    // loan lines already present (from the summary prefill) are re-derived here
    // so the deduction stays authoritative and is never double-counted.
    const { lines: loanLines, repayments } = await computeLoanDeductions(input.employee);
    const userDeductions = (input.deductions ?? []).filter((d) => !d.label.startsWith(LOAN_DEDUCTION_PREFIX));
    // One-time payments (earnings) and deductions registered for this month.
    const oneTime = await computeOneTimeAdjustments(input.employee, input.month);
    // Approved expense reimbursements paid out this month (earnings).
    const reimb = await computeReimbursements(input.employee, input.month);
    // Overtime worked, paid out this month (earnings).
    const ot = await computeOvertime(input.employee, input.month);
    const earnings = [...(input.earnings ?? []), ...oneTime.earnings, ...reimb.earnings, ...ot.earnings];
    const deductions = [...userDeductions, ...loanLines, ...oneTime.deductions];

    const { start } = monthBounds(input.month);
    const doc = new Payslip({
      ...input,
      earnings,
      deductions,
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

    // Record loan repayments + mark one-time adjustments applied now the slip exists.
    if (repayments.length) await recordLoanRepayments(repayments);
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

    if (input.month !== undefined) { record.month = input.month; record.monthDate = monthBounds(input.month).start; }
    if (input.currency !== undefined) record.currency = input.currency;
    if (input.earnings !== undefined) record.earnings = input.earnings as never;
    if (input.deductions !== undefined) record.deductions = input.deductions as never;
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

  async remove(id: string) {
    const record = await Payslip.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Payslip not found"), { statusCode: 404 });
    return { message: "Payslip deleted successfully" };
  }

  /** Attendance/leave summary for a month — used to prefill LOP + a Basic line. */
  async summary(employeeId: string, month: string) {
    const emp = await Employee.findOne(scoped({ _id: employeeId }))
      .populate({ path: "user", select: "workSchedule", populate: { path: "workSchedule", select: "timeZone" } })
      .lean<IEmployee & { user?: { _id?: unknown; workSchedule?: { timeZone?: string } } | null }>();
    if (!emp) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });

    // Bound the month in the employee's timezone so local days at the month
    // edges bucket correctly (attendance is stored as local-midnight-UTC).
    const tz = emp.user?.workSchedule?.timeZone || "Asia/Dubai";
    const { start, end } = monthBoundsTz(month, tz);

    // Active-loan instalments that will be deducted from this payslip.
    const { lines: loanDeductions } = await computeLoanDeductions(employeeId);
    // Salary breakup in force: a structure assignment if one exists, else a
    // single Basic = the salary from any effective-dated increment (resolved
    // internally by resolveSalaryBreakup, which also lets a later increment
    // override an assignment's frozen Basic). `salary` (the gross of all
    // earnings) is the LOP base.
    const breakup = await resolveSalaryBreakup(employeeId, month, emp.salary ?? 0);

    const base = {
      present: 0, late: 0, half: 0, absent: 0, unpaidLeaveDays: 0, lopDays: 0, latePenaltyDays: 0,
      salary: breakup.gross,
      earnings: breakup.earnings,
      structureDeductions: breakup.deductions,
      structureName: breakup.structureName,
      currency: emp.currency ?? "AED", loanDeductions,
    };
    const userId = emp.user?._id ?? null;
    if (!userId) return base;

    const [att, unpaid] = await Promise.all([
      Attendance.find({ user: userId, date: { $gte: start, $lt: end } }).select("status date timeZone").lean(),
      LeaveRequest.find({ user: userId, type: "unpaid", status: "approved", startDate: { $lt: end }, endDate: { $gte: start } }).select("days startDate endDate").lean(),
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
    for (const l of unpaid) {
      const from = new Date(Math.max(new Date(l.startDate).getTime(), start.getTime()));
      const to = new Date(Math.min(new Date(l.endDate).getTime(), end.getTime() - 1));
      const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
      const toU = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
      while (cur <= toU) { lopFull.add(cur.toISOString().slice(0, 10)); cur.setUTCDate(cur.getUTCDate() + 1); }
    }
    base.unpaidLeaveDays = unpaid.reduce((s, l) => s + (l.days || 0), 0);
    let halfCount = 0;
    for (const k of halfSet) if (!lopFull.has(k)) halfCount++;
    base.lopDays = Math.round((lopFull.size + halfCount * 0.5) * 100) / 100;

    // Repeated lateness beyond the org's configured grace converts into a
    // separate half-day-equivalent deduction (kept apart from absence-driven LOP).
    const penaltyPolicy = await getAttendancePenaltyPolicy();
    base.latePenaltyDays = computeLatePenaltyDays(base.late, penaltyPolicy);
    return base;
  }

  /**
   * Monthly payroll preview: for every active employee, auto-compute base pay,
   * attendance-driven Loss of Pay, loan instalments and net — plus whether a
   * payslip already exists for the month. Uses the same math as a single
   * payslip (base = salary, LOP per-day = salary/30, loans from active loans).
   */
  async runPreview(month: string) {
    const employees = await Employee.find(scoped({ status: { $ne: "terminated" } }))
      .select("name employeeCode salary currency user")
      .sort({ name: 1 });
    const existing = await Payslip.find(scoped({ month })).select("employee status");
    const existMap = new Map(existing.map((p) => [String(p.employee), { id: String(p._id), status: p.status }]));

    const round = (n: number) => Math.round(n * 100) / 100;
    const rows = [];
    for (const emp of employees) {
      const s = await this.summary(String(emp._id), month);
      const base = s.salary || 0;
      const perDay = round(base / 30);
      const lopAmount = round(perDay * s.lopDays);
      const latePenaltyAmount = round(perDay * s.latePenaltyDays);
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
      const existRow = existMap.get(String(emp._id));
      rows.push({
        employee: { _id: emp._id, name: emp.name, employeeCode: emp.employeeCode },
        currency: s.currency,
        salary: base,
        earnings: s.earnings ?? [{ label: "Basic", amount: base }],
        structureName: s.structureName ?? null,
        structureDeductions: s.structureDeductions ?? [],
        lopDays: s.lopDays,
        lopAmount,
        latePenaltyDays: s.latePenaltyDays,
        latePenaltyAmount,
        loanTotal,
        oneTimePayments,
        oneTimeDeductions,
        reimbursements,
        overtime,
        totalDeductions,
        netPay: round(base + oneTimePayments + reimbursements + overtime - totalDeductions),
        payslipId: existRow?.id ?? null,
        status: existRow?.status ?? null, // null → not generated yet
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
    const employees = await Employee.find(scoped({ status: { $ne: "terminated" } }))
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
      if (s.lopDays > 0 && s.salary > 0) deductions.push({ label: `Loss of Pay (${s.lopDays}d)`, amount: round((s.salary / 30) * s.lopDays) });
      if (s.latePenaltyDays > 0 && s.salary > 0) deductions.push({ label: `Late Penalty (${s.latePenaltyDays}d)`, amount: round((s.salary / 30) * s.latePenaltyDays) });
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
    const employees = await Employee.find(scoped({ status: { $ne: "terminated" } })).select("_id salary");
    const existing = await Payslip.find(scoped({ month })).select("employee");
    const existSet = new Set(existing.map((p) => String(p.employee)));

    let created = 0;
    let skipped = 0;
    for (const emp of employees) {
      if (existSet.has(String(emp._id))) { skipped++; continue; }
      const s = await this.summary(String(emp._id), month);
      // Earnings from the salary structure (Basic + allowances), else a single Basic.
      const earnings = s.earnings ?? [{ label: "Basic", amount: s.salary || 0 }];
      // Recurring structure deductions; LOP/loans/one-time appended below + in create().
      const deductions: { label: string; amount: number }[] = [...(s.structureDeductions ?? [])];
      if (s.lopDays > 0 && s.salary > 0) {
        const perDay = Math.round((s.salary / 30) * 100) / 100;
        deductions.push({ label: `Loss of Pay (${s.lopDays}d)`, amount: Math.round(perDay * s.lopDays * 100) / 100 });
      }
      if (s.latePenaltyDays > 0 && s.salary > 0) {
        const perDay = Math.round((s.salary / 30) * 100) / 100;
        deductions.push({ label: `Late Penalty (${s.latePenaltyDays}d)`, amount: Math.round(perDay * s.latePenaltyDays * 100) / 100 });
      }
      // Loan instalments are appended + recorded by create().
      await this.create({ employee: String(emp._id), month, currency: s.currency, earnings, deductions, status: "draft" } as never, issuerId);
      created++;
    }
    return { month, created, skipped, total: employees.length };
  }
}
