import { Payslip } from "../models/Payslip.js";
import { Employee } from "../models/Employee.js";
import { Attendance } from "../models/Attendance.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import type { CreatePayslipInput, UpdatePayslipInput } from "../validations/payslipValidation.js";
import type { PaginationQuery, IEmployee } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { computeLoanDeductions, recordLoanRepayments, LOAN_DEDUCTION_PREFIX } from "./loanService.js";

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
    const deductions = [...userDeductions, ...loanLines];

    const { start } = monthBounds(input.month);
    const doc = new Payslip({
      ...input,
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

    // Record the repayments now that the payslip is persisted.
    if (repayments.length) await recordLoanRepayments(repayments);
    return Payslip.findById(doc._id).populate(POP);
  }

  async list(query: PayslipQuery) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "20", 10)));
    const skip = (page - 1) * limit;

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
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "20", 10)));
    const skip = (page - 1) * limit;
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
    const emp = await Employee.findOne(scoped({ _id: employeeId })).lean<IEmployee & { user?: unknown }>();
    if (!emp) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
    const { start, end } = monthBounds(month);

    // Active-loan instalments that will be deducted from this payslip.
    const { lines: loanDeductions } = await computeLoanDeductions(employeeId);

    const base = { present: 0, late: 0, half: 0, absent: 0, unpaidLeaveDays: 0, lopDays: 0, salary: emp.salary ?? 0, currency: emp.currency ?? "AED", loanDeductions };
    if (!emp.user) return base;

    const [att, unpaid] = await Promise.all([
      Attendance.find({ user: emp.user, date: { $gte: start, $lt: end } }).select("status").lean(),
      LeaveRequest.find({ user: emp.user, type: "unpaid", status: "approved", startDate: { $lt: end }, endDate: { $gte: start } }).select("days").lean(),
    ]);
    for (const a of att) {
      if (a.status === "present") base.present++;
      else if (a.status === "late") base.late++;
      else if (a.status === "half_day") base.half++;
      else if (a.status === "absent") base.absent++;
    }
    base.unpaidLeaveDays = unpaid.reduce((s, l) => s + (l.days || 0), 0);
    base.lopDays = Math.round((base.absent + base.unpaidLeaveDays + base.half * 0.5) * 100) / 100;
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

    const rows = [];
    for (const emp of employees) {
      const s = await this.summary(String(emp._id), month);
      const base = s.salary || 0;
      const perDay = Math.round((base / 30) * 100) / 100;
      const lopAmount = Math.round(perDay * s.lopDays * 100) / 100;
      const loanTotal = Math.round((s.loanDeductions ?? []).reduce((a, l) => a + l.amount, 0) * 100) / 100;
      const totalDeductions = Math.round((lopAmount + loanTotal) * 100) / 100;
      const existRow = existMap.get(String(emp._id));
      rows.push({
        employee: { _id: emp._id, name: emp.name, employeeCode: emp.employeeCode },
        currency: s.currency,
        salary: base,
        lopDays: s.lopDays,
        lopAmount,
        loanTotal,
        totalDeductions,
        netPay: Math.round((base - totalDeductions) * 100) / 100,
        payslipId: existRow?.id ?? null,
        status: existRow?.status ?? null, // null → not generated yet
      });
    }
    return { month, rows };
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
      const earnings = [{ label: "Basic", amount: s.salary || 0 }];
      const deductions: { label: string; amount: number }[] = [];
      if (s.lopDays > 0 && s.salary > 0) {
        const perDay = Math.round((s.salary / 30) * 100) / 100;
        deductions.push({ label: `Loss of Pay (${s.lopDays}d)`, amount: Math.round(perDay * s.lopDays * 100) / 100 });
      }
      // Loan instalments are appended + recorded by create().
      await this.create({ employee: String(emp._id), month, currency: s.currency, earnings, deductions, status: "draft" } as never, issuerId);
      created++;
    }
    return { month, created, skipped, total: employees.length };
  }
}
