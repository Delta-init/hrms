import { OneTimeAdjustment } from "../models/OneTimeAdjustment.js";
import { Employee } from "../models/Employee.js";
import type { CreateOneTimeInput, UpdateOneTimeInput } from "../validations/oneTimeAdjustmentValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";

interface OneTimeQuery extends PaginationQuery {
  employee?: string;
  month?: string;
  kind?: string;
  applied?: string;
}

const POP = [
  { path: "employee", select: "name employeeCode designation currency" },
  { path: "createdBy", select: "name" },
];

export class OneTimeAdjustmentService {
  async create(input: CreateOneTimeInput, createdBy: string) {
    const employee = await Employee.findOne(scoped({ _id: input.employee }));
    if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
    const doc = await OneTimeAdjustment.create({
      organization: getOrgId(),
      employee: input.employee,
      user: employee.user ?? null,
      kind: input.kind,
      label: input.label,
      amount: input.amount,
      month: input.month,
      notes: input.notes,
      applied: false,
      createdBy,
    });
    return OneTimeAdjustment.findById(doc._id).populate(POP);
  }

  async list(query: OneTimeQuery) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "20", 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.employee) filter.employee = query.employee;
    if (query.month) filter.month = query.month;
    if (query.kind) filter.kind = query.kind;
    if (query.applied === "true" || query.applied === "false") filter.applied = query.applied === "true";

    const sortable = new Set(["month", "amount", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "createdAt";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      OneTimeAdjustment.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit),
      OneTimeAdjustment.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await OneTimeAdjustment.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Adjustment not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateOneTimeInput) {
    const record = await OneTimeAdjustment.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Adjustment not found"), { statusCode: 404 });
    if (record.applied) throw Object.assign(new Error("This adjustment has already been applied to a payslip"), { statusCode: 400 });
    Object.assign(record, input);
    await record.save();
    return OneTimeAdjustment.findById(id).populate(POP);
  }

  async remove(id: string) {
    const record = await OneTimeAdjustment.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Adjustment not found"), { statusCode: 404 });
    if (record.applied) throw Object.assign(new Error("This adjustment has already been applied to a payslip"), { statusCode: 400 });
    await OneTimeAdjustment.deleteOne({ _id: record._id });
  }
}

interface Line { label: string; amount: number }

/**
 * Unapplied one-time payments (earnings) and deductions for an employee-month.
 * Returns the lines to add to the payslip and the ids to mark applied.
 */
export async function computeOneTimeAdjustments(
  employeeId: string,
  month: string
): Promise<{ earnings: Line[]; deductions: Line[]; ids: string[] }> {
  const items = await OneTimeAdjustment.find(scoped({ employee: employeeId, month, applied: false }));
  const earnings: Line[] = [];
  const deductions: Line[] = [];
  const ids: string[] = [];
  for (const a of items) {
    (a.kind === "payment" ? earnings : deductions).push({ label: a.label, amount: a.amount });
    ids.push(String(a._id));
  }
  return { earnings, deductions, ids };
}

/** Mark one-time adjustments as applied to a payslip so they aren't reused. */
export async function markOneTimeApplied(ids: string[], payslipId: string): Promise<void> {
  if (!ids.length) return;
  await OneTimeAdjustment.updateMany({ _id: { $in: ids } }, { $set: { applied: true, payslip: payslipId } });
}
