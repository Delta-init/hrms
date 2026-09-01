import { Employee } from "../models/Employee.js";
import { Attendance } from "../models/Attendance.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Reimbursement } from "../models/Reimbursement.js";
import { Payslip } from "../models/Payslip.js";
import type { RunReportInput } from "../validations/reportValidation.js";
import { scoped, orgFilter } from "../utils/orgContext.js";

const MAX_ROWS = 1000;

interface ColumnDef { key: string; label: string; }
interface FilterOption { value: string; label: string; }
interface FilterDef { key: string; label: string; type: "date" | "select"; options?: FilterOption[]; }
interface SourceDef { key: string; label: string; columns: ColumnDef[]; filters: FilterDef[]; }

const DEPARTMENT_FILTER: FilterDef = { key: "department", label: "Department", type: "select" };
const DATE_FROM: FilterDef = { key: "dateFrom", label: "From", type: "date" };
const DATE_TO: FilterDef = { key: "dateTo", label: "To", type: "date" };
const statusFilter = (options: FilterOption[]): FilterDef => ({ key: "status", label: "Status", type: "select", options });

export const REPORT_SOURCES: SourceDef[] = [
  {
    key: "employees",
    label: "Employees",
    columns: [
      { key: "employeeCode", label: "Code" }, { key: "name", label: "Name" }, { key: "email", label: "Email" },
      { key: "department", label: "Department" }, { key: "designation", label: "Designation" },
      { key: "employmentType", label: "Employment Type" }, { key: "status", label: "Status" },
      { key: "location", label: "Location" }, { key: "joiningDate", label: "Joining Date" },
    ],
    filters: [
      statusFilter(["active", "probation", "on_leave", "notice_period", "terminated"].map((v) => ({ value: v, label: v.replace(/_/g, " ") }))),
      DEPARTMENT_FILTER, DATE_FROM, DATE_TO,
    ],
  },
  {
    key: "attendance",
    label: "Attendance",
    columns: [
      { key: "employeeCode", label: "Code" }, { key: "employeeName", label: "Employee" }, { key: "department", label: "Department" },
      { key: "date", label: "Date" }, { key: "status", label: "Status" }, { key: "checkIn", label: "Check In" },
      { key: "checkOut", label: "Check Out" }, { key: "workedMinutes", label: "Worked (min)" }, { key: "lateMinutes", label: "Late (min)" },
    ],
    filters: [
      statusFilter(["present", "absent", "late", "half_day", "on_leave", "holiday", "weekend", "wfh"].map((v) => ({ value: v, label: v.replace(/_/g, " ") }))),
      DEPARTMENT_FILTER, DATE_FROM, DATE_TO,
    ],
  },
  {
    key: "leave",
    label: "Leave",
    columns: [
      { key: "employeeCode", label: "Code" }, { key: "employeeName", label: "Employee" }, { key: "department", label: "Department" },
      { key: "type", label: "Type" }, { key: "startDate", label: "Start" }, { key: "endDate", label: "End" },
      { key: "days", label: "Days" }, { key: "status", label: "Status" },
    ],
    filters: [
      statusFilter(["pending", "approved", "rejected", "cancelled"].map((v) => ({ value: v, label: v }))),
      DEPARTMENT_FILTER, DATE_FROM, DATE_TO,
    ],
  },
  {
    key: "reimbursements",
    label: "Reimbursements",
    columns: [
      { key: "employeeCode", label: "Code" }, { key: "employeeName", label: "Employee" }, { key: "department", label: "Department" },
      { key: "category", label: "Category" }, { key: "title", label: "Title" }, { key: "amount", label: "Amount" },
      { key: "expenseDate", label: "Expense Date" }, { key: "month", label: "Month" }, { key: "status", label: "Status" },
    ],
    filters: [
      statusFilter(["pending", "approved", "rejected", "paid"].map((v) => ({ value: v, label: v }))),
      DEPARTMENT_FILTER, DATE_FROM, DATE_TO,
    ],
  },
  {
    key: "payslips",
    label: "Payslips",
    columns: [
      { key: "employeeCode", label: "Code" }, { key: "employeeName", label: "Employee" }, { key: "department", label: "Department" },
      { key: "month", label: "Month" }, { key: "currency", label: "Currency" }, { key: "grossPay", label: "Gross Pay" },
      { key: "totalDeductions", label: "Deductions" }, { key: "netPay", label: "Net Pay" }, { key: "status", label: "Status" },
    ],
    filters: [
      statusFilter(["draft", "issued", "paid"].map((v) => ({ value: v, label: v }))),
      DEPARTMENT_FILTER, DATE_FROM, DATE_TO,
    ],
  },
];

type Row = Record<string, string | number | null>;

function dateRange(dateFrom?: string, dateTo?: string) {
  const range: Record<string, Date> = {};
  if (dateFrom) range.$gte = new Date(dateFrom);
  if (dateTo) range.$lte = new Date(dateTo);
  return Object.keys(range).length ? range : undefined;
}

function pickColumns(rows: Row[], columns?: string[]): Row[] {
  if (!columns || columns.length === 0) return rows;
  return rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
}

export class ReportService {
  async listSources() {
    return REPORT_SOURCES;
  }

  async run(input: RunReportInput): Promise<{ rows: Row[] }> {
    const { source, columns, filters } = input;
    switch (source) {
      case "employees": return { rows: pickColumns(await this.runEmployees(filters), columns) };
      case "attendance": return { rows: pickColumns(await this.runAttendance(filters), columns) };
      case "leave": return { rows: pickColumns(await this.runLeave(filters), columns) };
      case "reimbursements": return { rows: pickColumns(await this.runReimbursements(filters), columns) };
      case "payslips": return { rows: pickColumns(await this.runPayslips(filters), columns) };
    }
  }

  private async runEmployees(filters: RunReportInput["filters"]): Promise<Row[]> {
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (filters.status) filter.status = filters.status;
    if (filters.department) filter.department = filters.department;
    const range = dateRange(filters.dateFrom, filters.dateTo);
    if (range) filter.joiningDate = range;

    const records = await Employee.find(filter)
      .select("employeeCode name email designation department employmentType status location joiningDate")
      .populate("department", "name")
      .sort({ name: 1 }).limit(MAX_ROWS).lean();

    return records.map((e) => ({
      employeeCode: e.employeeCode, name: e.name, email: e.email ?? null,
      department: (e.department as { name?: string } | null)?.name ?? null,
      designation: e.designation ?? null, employmentType: e.employmentType ?? null,
      status: e.status, location: e.location ?? null,
      joiningDate: e.joiningDate ? new Date(e.joiningDate).toISOString().slice(0, 10) : null,
    }));
  }

  /** Resolve the `user` ids for employees in a department — used to filter user-keyed sources by department. */
  private async userIdsInDepartment(department: string): Promise<string[]> {
    const emps = await Employee.find(scoped({ department })).select("user").lean();
    return emps.filter((e) => e.user).map((e) => String(e.user));
  }

  private async employeesByUserIds(userIds: string[]) {
    const emps = await Employee.find({ user: { $in: userIds } })
      .select("user name employeeCode department").populate("department", "name").lean();
    return new Map(emps.map((e) => [String(e.user), e]));
  }

  private async runAttendance(filters: RunReportInput["filters"]): Promise<Row[]> {
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (filters.status) filter.status = filters.status;
    if (filters.department) filter.user = { $in: await this.userIdsInDepartment(filters.department) };
    // Matched on the day the record is written under, for the same reason the
    // attendance list is: a range of instants is anchored in one zone, and
    // everybody outside it falls the wrong side of the edge. An exported month
    // was shifting Asia/Kolkata staff by a day throughout.
    const dayFrom = filters.dateFrom ? String(filters.dateFrom).slice(0, 10) : undefined;
    const dayTo = filters.dateTo ? String(filters.dateTo).slice(0, 10) : undefined;
    if (dayFrom || dayTo) {
      filter.localDay = { ...(dayFrom ? { $gte: dayFrom } : {}), ...(dayTo ? { $lte: dayTo } : {}) };
    }

    const records = await Attendance.find(filter).sort({ date: -1 }).limit(MAX_ROWS).lean();
    const empByUser = await this.employeesByUserIds([...new Set(records.map((r) => String(r.user)))]);

    return records.map((r) => {
      const emp = empByUser.get(String(r.user));
      return {
        employeeCode: emp?.employeeCode ?? null, employeeName: emp?.name ?? null,
        department: (emp?.department as { name?: string } | null)?.name ?? null,
        date: new Date(r.date).toISOString().slice(0, 10), status: r.status,
        checkIn: r.checkIn ? new Date(r.checkIn).toISOString() : null,
        checkOut: r.checkOut ? new Date(r.checkOut).toISOString() : null,
        workedMinutes: r.workedMinutes ?? 0, lateMinutes: r.lateMinutes ?? 0,
      };
    });
  }

  private async runLeave(filters: RunReportInput["filters"]): Promise<Row[]> {
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (filters.status) filter.status = filters.status;
    if (filters.department) filter.user = { $in: await this.userIdsInDepartment(filters.department) };
    const range = dateRange(filters.dateFrom, filters.dateTo);
    if (range) filter.startDate = range;

    const records = await LeaveRequest.find(filter).sort({ startDate: -1 }).limit(MAX_ROWS).lean();
    const empByUser = await this.employeesByUserIds([...new Set(records.map((r) => String(r.user)))]);

    return records.map((r) => {
      const emp = empByUser.get(String(r.user));
      return {
        employeeCode: emp?.employeeCode ?? null, employeeName: emp?.name ?? null,
        department: (emp?.department as { name?: string } | null)?.name ?? null,
        type: r.type, startDate: new Date(r.startDate).toISOString().slice(0, 10),
        endDate: new Date(r.endDate).toISOString().slice(0, 10), days: r.days, status: r.status,
      };
    });
  }

  private async employeeIdsInDepartment(department: string): Promise<string[]> {
    const emps = await Employee.find(scoped({ department })).select("_id").lean();
    return emps.map((e) => String(e._id));
  }

  private async runReimbursements(filters: RunReportInput["filters"]): Promise<Row[]> {
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (filters.status) filter.status = filters.status;
    if (filters.department) filter.employee = { $in: await this.employeeIdsInDepartment(filters.department) };
    const range = dateRange(filters.dateFrom, filters.dateTo);
    if (range) filter.expenseDate = range;

    const records = await Reimbursement.find(filter)
      .populate({ path: "employee", select: "name employeeCode department", populate: { path: "department", select: "name" } })
      .sort({ expenseDate: -1 }).limit(MAX_ROWS).lean();

    return records.map((r) => {
      const emp = r.employee as unknown as { name?: string; employeeCode?: string; department?: { name?: string } } | null;
      return {
        employeeCode: emp?.employeeCode ?? null, employeeName: emp?.name ?? null, department: emp?.department?.name ?? null,
        category: r.category, title: r.title, amount: r.amount,
        expenseDate: new Date(r.expenseDate).toISOString().slice(0, 10), month: r.month, status: r.status,
      };
    });
  }

  private async runPayslips(filters: RunReportInput["filters"]): Promise<Row[]> {
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (filters.status) filter.status = filters.status;
    if (filters.department) filter.employee = { $in: await this.employeeIdsInDepartment(filters.department) };
    const range = dateRange(filters.dateFrom, filters.dateTo);
    if (range) filter.monthDate = range;

    const records = await Payslip.find(filter)
      .populate({ path: "employee", select: "name employeeCode department", populate: { path: "department", select: "name" } })
      .sort({ monthDate: -1 }).limit(MAX_ROWS).lean();

    return records.map((p) => {
      const emp = p.employee as unknown as { name?: string; employeeCode?: string; department?: { name?: string } } | null;
      return {
        employeeCode: emp?.employeeCode ?? null, employeeName: emp?.name ?? null, department: emp?.department?.name ?? null,
        month: p.month, currency: p.currency, grossPay: p.grossPay, totalDeductions: p.totalDeductions,
        netPay: p.netPay, status: p.status,
      };
    });
  }
}
