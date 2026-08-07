import { Reimbursement } from "../models/Reimbursement.js";
import { Employee } from "../models/Employee.js";
import type {
  CreateReimbursementInput, UpdateReimbursementInput, ReviewReimbursementInput,
} from "../validations/reimbursementValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { beginWorkflowState, resolveReviewOutcome } from "./approvalWorkflowService.js";
import type { ReviewerRole } from "./approvalWorkflowService.js";
import { parsePagination } from "../utils/query.js";

interface ReimbursementQuery extends PaginationQuery {
  employee?: string;
  user?: string;
  status?: string;
  month?: string;
  category?: string;
}

const POP = [
  { path: "employee", select: "name employeeCode designation currency" },
  { path: "reviewedBy", select: "name email" },
  { path: "createdBy", select: "name" },
];

/** Label a reimbursement earning line for a payslip. */
export const REIMBURSE_PREFIX = "Reimbursement";

export class ReimbursementService {
  /**
   * File a claim. Managers (reimbursements.approve) may file for any employee via
   * `input.employee`; everyone else files for themselves, so the subject is
   * resolved from the caller's own user account.
   */
  async create(
    input: CreateReimbursementInput,
    opts: { createdBy: string; subjectUserId: string; canApproveOthers: boolean }
  ) {
    let employee;
    if (opts.canApproveOthers && input.employee) {
      employee = await Employee.findOne(scoped({ _id: input.employee }));
    } else {
      employee = await Employee.findOne(scoped({ user: opts.subjectUserId }));
    }
    if (!employee) throw Object.assign(new Error("Employee profile not found for this claim"), { statusCode: 404 });

    const workflow = await beginWorkflowState("reimbursements");
    const doc = await Reimbursement.create({
      organization: getOrgId(),
      employee: employee._id,
      user: employee.user ?? opts.subjectUserId,
      category: input.category,
      title: input.title,
      amount: input.amount,
      expenseDate: input.expenseDate,
      month: input.month,
      description: input.description,
      receiptUrl: input.receiptUrl,
      status: "pending",
      createdBy: opts.createdBy,
      ...workflow,
    });
    return Reimbursement.findById(doc._id).populate(POP);
  }

  async list(query: ReimbursementQuery) {
    const { page, limit, skip } = parsePagination(query, 20, 200);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.employee) filter.employee = query.employee;
    if (query.user) filter.user = query.user;
    if (query.status) filter.status = query.status;
    if (query.month) filter.month = query.month;
    if (query.category) filter.category = query.category;

    const sortable = new Set(["expenseDate", "amount", "month", "status", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "createdAt";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      Reimbursement.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit),
      Reimbursement.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  /** The caller's own claims (self-service). */
  async listMine(userId: string, query: ReimbursementQuery) {
    return this.list({ ...query, user: userId });
  }

  async getById(id: string) {
    const record = await Reimbursement.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Reimbursement not found"), { statusCode: 404 });
    return record;
  }

  /** Edit claim details — only allowed while still pending. */
  async update(id: string, input: UpdateReimbursementInput) {
    const record = await Reimbursement.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Reimbursement not found"), { statusCode: 404 });
    if (record.status !== "pending")
      throw Object.assign(new Error("Only pending claims can be edited"), { statusCode: 400 });
    Object.assign(record, input);
    await record.save();
    return Reimbursement.findById(id).populate(POP);
  }

  /** Approve or reject a pending claim. */
  async review(id: string, input: ReviewReimbursementInput, reviewerId: string, reviewerRole: ReviewerRole) {
    const record = await Reimbursement.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Reimbursement not found"), { statusCode: 404 });
    if (record.status === "paid")
      throw Object.assign(new Error("This claim has already been paid out"), { statusCode: 400 });
    if (input.reviewNote !== undefined) record.reviewNote = input.reviewNote ?? undefined;

    const outcome = resolveReviewOutcome(
      record.approvalSteps, record.workflowStep, input.status, input.reviewNote, reviewerRole
    );
    record.approvalTrail = [...(record.approvalTrail ?? []), outcome.trailEntry];
    if (outcome.advance) {
      record.workflowStep = (record.workflowStep ?? 1) + 1;
    } else {
      record.status = input.status;
      record.reviewedBy = reviewerId as never;
      record.reviewedAt = new Date();
    }
    await record.save();
    return Reimbursement.findById(id).populate(POP);
  }

  async remove(id: string) {
    const record = await Reimbursement.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Reimbursement not found"), { statusCode: 404 });
    if (record.status === "paid")
      throw Object.assign(new Error("A paid-out claim cannot be deleted"), { statusCode: 400 });
    await Reimbursement.deleteOne({ _id: record._id });
    return { message: "Reimbursement deleted successfully" };
  }
}

/**
 * Approved-but-unpaid reimbursements for an employee's payout month, as payslip
 * earning lines. Consumed by the payroll run, then marked paid.
 */
export async function computeReimbursements(employeeId: string, month: string) {
  const claims = await Reimbursement.find(scoped({ employee: employeeId, month, status: "approved" }))
    .select("title amount")
    .lean();
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    earnings: claims.map((c) => ({ label: `${REIMBURSE_PREFIX}: ${c.title}`, amount: round(c.amount) })),
    ids: claims.map((c) => String(c._id)),
  };
}

/** Mark reimbursements paid + link them to the payslip that paid them out. */
export async function markReimbursementsPaid(ids: string[], payslipId: string) {
  if (!ids.length) return;
  await Reimbursement.updateMany(
    scoped({ _id: { $in: ids } }),
    { $set: { status: "paid", payslip: payslipId } }
  );
}

/**
 * Release claims a payslip paid out, for when that payslip is deleted.
 *
 * Without this a claim stayed "paid", pointing at a payslip that no longer
 * exists, and could never be paid again — the employee simply lost the money.
 */
export async function releaseReimbursements(payslipId: string) {
  await Reimbursement.updateMany(
    { payslip: payslipId },
    { $set: { status: "approved", payslip: null } }
  );
}
