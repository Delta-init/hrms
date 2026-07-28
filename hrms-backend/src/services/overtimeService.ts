import { Overtime } from "../models/Overtime.js";
import { Employee } from "../models/Employee.js";
import type { CreateOvertimeInput, UpdateOvertimeInput } from "../validations/overtimeValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";

interface OvertimeQuery extends PaginationQuery {
  employee?: string;
  month?: string;
  applied?: string;
}

const POP = [
  { path: "employee", select: "name employeeCode designation currency" },
  { path: "createdBy", select: "name" },
];

export class OvertimeService {
  async create(input: CreateOvertimeInput, createdBy: string) {
    const employee = await Employee.findOne(scoped({ _id: input.employee }));
    if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
    const doc = await Overtime.create({
      organization: getOrgId(),
      employee: input.employee,
      user: employee.user ?? null,
      date: input.date,
      hours: input.hours,
      hourlyRate: input.hourlyRate,
      multiplier: input.multiplier,
      month: input.month,
      notes: input.notes,
      applied: false,
      createdBy,
    });
    return Overtime.findById(doc._id).populate(POP);
  }

  async list(query: OvertimeQuery) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "20", 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.employee) filter.employee = query.employee;
    if (query.month) filter.month = query.month;
    if (query.applied === "true" || query.applied === "false") filter.applied = query.applied === "true";

    const sortable = new Set(["date", "hours", "amount", "month", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "date";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      Overtime.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit),
      Overtime.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await Overtime.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Overtime not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateOvertimeInput) {
    const record = await Overtime.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Overtime not found"), { statusCode: 404 });
    if (record.applied) throw Object.assign(new Error("This overtime has already been paid on a payslip"), { statusCode: 400 });
    Object.assign(record, input);
    await record.save(); // recomputes amount
    return Overtime.findById(id).populate(POP);
  }

  async remove(id: string) {
    const record = await Overtime.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Overtime not found"), { statusCode: 404 });
    if (record.applied) throw Object.assign(new Error("This overtime has already been paid on a payslip"), { statusCode: 400 });
    await Overtime.deleteOne({ _id: record._id });
    return { message: "Overtime deleted successfully" };
  }
}

/** Unapplied overtime for an employee's payout month, as payslip earning lines. */
export async function computeOvertime(employeeId: string, month: string) {
  const records = await Overtime.find(scoped({ employee: employeeId, month, applied: false }))
    .select("hours amount").lean();
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    earnings: records.map((o) => ({ label: `Overtime (${o.hours}h)`, amount: round(o.amount) })),
    ids: records.map((o) => String(o._id)),
  };
}

/** Mark overtime records paid + link them to the payslip. */
export async function markOvertimeApplied(ids: string[], payslipId: string) {
  if (!ids.length) return;
  await Overtime.updateMany(scoped({ _id: { $in: ids } }), { $set: { applied: true, payslip: payslipId } });
}
