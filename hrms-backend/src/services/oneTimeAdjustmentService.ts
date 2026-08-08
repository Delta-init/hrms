import { Types } from "mongoose";
import { OneTimeAdjustment } from "../models/OneTimeAdjustment.js";
import { Employee } from "../models/Employee.js";
import type { CreateOneTimeInput, UpdateOneTimeInput } from "../validations/oneTimeAdjustmentValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { parsePagination } from "../utils/query.js";

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
    const { page, limit, skip } = parsePagination(query, 20, 200);

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
export interface AdjustmentRecovery {
  adjustmentId: string;
  amount: number;
}

/**
 * One-time items still owed for a month.
 *
 * Payments are taken whole. Deductions report only what is left to recover, so
 * a fine larger than one month's pay is collected over several payslips instead
 * of driving a single one negative — the caller decides how much of that the
 * month can afford.
 *
 * Anything from an earlier month that is still outstanding is swept up too:
 * unrecovered money should not be forgotten because the calendar moved on.
 */
export async function computeOneTimeAdjustments(
  employeeId: string,
  month: string
): Promise<{ earnings: Line[]; deductions: Array<Line & { adjustmentId: string }>; ids: string[] }> {
  // A payment belongs to the month it was entered for. A bonus for August is
  // an August bonus; if August's payslip never ran, it stays waiting for
  // August rather than quietly appearing in September's pay.
  //
  // A deduction is money owed, so it does carry: what one month's pay could
  // not absorb is collected by the next. That is why the two are matched
  // differently rather than by one rule.
  const items = await OneTimeAdjustment.find(
    scoped({
      employee: employeeId,
      applied: false,
      $or: [
        { kind: "payment", month },
        { kind: "deduction", month: { $lte: month } },
      ],
    })
  ).sort({ month: 1, createdAt: 1 });

  const earnings: Line[] = [];
  const deductions: Array<Line & { adjustmentId: string }> = [];
  const ids: string[] = [];
  for (const a of items) {
    const remaining = Math.round((a.amount - (a.appliedAmount ?? 0)) * 100) / 100;
    if (remaining <= 0) continue;
    if (a.kind === "payment") {
      earnings.push({ label: a.label, amount: remaining });
      ids.push(String(a._id));
    } else {
      deductions.push({ label: a.label, amount: remaining, adjustmentId: String(a._id) });
    }
  }
  return { earnings, deductions, ids };
}

/** Mark one-time payments as fully applied to a payslip so they aren't reused. */
export async function markOneTimeApplied(ids: string[], payslipId: string): Promise<void> {
  if (!ids.length) return;
  // An aggregation-pipeline update skips Mongoose casting, so the id has to be
  // converted here. Left as a string it was written as one, and every later
  // lookup by payslip quietly matched nothing.
  await OneTimeAdjustment.updateMany(
    { _id: { $in: ids } },
    [{ $set: { applied: true, appliedAmount: "$amount", payslip: new Types.ObjectId(payslipId) } }]
  );
}

/**
 * Hand back one-time payments a payslip had consumed, so they are pending again.
 *
 * Deductions come back through reverseAdjustmentRecoveries, which works off the
 * payslip's recoveries. Payments are never recovered — they are simply paid —
 * so nothing released them, and deleting a payslip left a bonus marked as paid
 * by a payslip that no longer existed. It could never be paid again.
 */
export async function releaseOneTimePayments(payslipId: string): Promise<void> {
  await OneTimeAdjustment.updateMany(
    // Both forms: rows written before the cast above hold a string.
    { kind: "payment", payslip: { $in: [new Types.ObjectId(payslipId), payslipId as never] } },
    { $set: { applied: false, appliedAmount: 0, payslip: null } }
  );
}

/** Credit what a payslip actually recovered; only close the item once it's whole. */
export async function recordAdjustmentRecoveries(
  recoveries: AdjustmentRecovery[],
  payslipId: string
): Promise<void> {
  for (const r of recoveries) {
    const item = await OneTimeAdjustment.findById(r.adjustmentId);
    if (!item) continue;
    item.appliedAmount = Math.min(item.amount, Math.round(((item.appliedAmount ?? 0) + r.amount) * 100) / 100);
    if (item.appliedAmount >= item.amount) { item.applied = true; item.payslip = payslipId as never; }
    await item.save();
  }
}

/** Undo what a payslip recovered, for when it is edited or deleted. */
export async function reverseAdjustmentRecoveries(recoveries: AdjustmentRecovery[]): Promise<void> {
  for (const r of recoveries) {
    const item = await OneTimeAdjustment.findById(r.adjustmentId);
    if (!item) continue;
    item.appliedAmount = Math.max(0, Math.round(((item.appliedAmount ?? 0) - r.amount) * 100) / 100);
    if (item.appliedAmount < item.amount) { item.applied = false; item.payslip = null; }
    await item.save();
  }
}
