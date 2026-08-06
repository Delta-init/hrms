import mongoose from "mongoose";
import { Confirmation } from "../models/Confirmation.js";
import { Employee } from "../models/Employee.js";
import type { InitiateConfirmationInput, ReviewConfirmationInput } from "../validations/confirmationValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { parsePagination } from "../utils/query.js";
import { beginWorkflowState, resolveReviewOutcome, assertNotSelfReview } from "./approvalWorkflowService.js";
import type { ReviewerRole } from "./approvalWorkflowService.js";

const POP = [
  { path: "employee", select: "name employeeCode designation location joiningDate probationPeriodDays department", populate: { path: "department", select: "name code" } },
  { path: "initiatedBy", select: "name" },
  { path: "reviewedBy", select: "name" },
];

const addDays = (d: Date, days: number) => {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
};

export interface DueConfirmation {
  employee: {
    _id: unknown; name: string; employeeCode?: string; designation?: string;
    location?: string; joiningDate?: Date; probationPeriodDays?: number;
  };
  dueDate: Date;
  daysLeft: number;
  overdue: boolean;
  /** An in-flight confirmation, when one has already been initiated. */
  pendingId?: string;
}

/**
 * Employees whose probation ends within `withinDays`.
 *
 * Derived from joining date + probation days rather than a stored flag, so it
 * stays correct if either is edited. Anyone already confirmed (a
 * confirmationDate on the employee) or terminated is excluded; overdue people
 * are kept, with a negative daysLeft, so a missed date stays visible instead of
 * dropping silently out of the window.
 */
export async function confirmationsDue(withinDays = 30, orgId?: string | null): Promise<DueConfirmation[]> {
  const now = new Date();
  const cutoff = addDays(now, withinDays);

  const match: Record<string, unknown> = {
    status: { $nin: ["terminated"] },
    joiningDate: { $ne: null },
    probationPeriodDays: { $gt: 0 },
    $or: [{ confirmationDate: null }, { confirmationDate: { $exists: false } }],
  };
  if (orgId) match.organization = new mongoose.Types.ObjectId(orgId);

  const emps = await Employee.find(match)
    .select("name employeeCode designation location joiningDate probationPeriodDays")
    .lean<Array<DueConfirmation["employee"] & { joiningDate: Date; probationPeriodDays: number }>>();

  const rows: DueConfirmation[] = [];
  for (const e of emps) {
    const dueDate = addDays(new Date(e.joiningDate), e.probationPeriodDays);
    if (dueDate > cutoff) continue;
    const daysLeft = Math.ceil((dueDate.getTime() - now.getTime()) / 86_400_000);
    rows.push({ employee: e, dueDate, daysLeft, overdue: daysLeft < 0 });
  }

  // Flag anyone who already has a confirmation in flight, so the UI can show
  // "awaiting approval" instead of offering to start a second one.
  if (rows.length) {
    const pending = await Confirmation.find({
      ...(orgId ? { organization: new mongoose.Types.ObjectId(orgId) } : {}),
      employee: { $in: rows.map((r) => r.employee._id) },
      status: "pending",
    }).select("employee").lean<Array<{ _id: unknown; employee: unknown }>>();
    const byEmp = new Map(pending.map((p) => [String(p.employee), String(p._id)]));
    for (const r of rows) r.pendingId = byEmp.get(String(r.employee._id));
  }

  rows.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  return rows;
}

export class ConfirmationService {
  async due(withinDays = 30) {
    return confirmationsDue(withinDays, getOrgId());
  }

  async list(query: PaginationQuery & { employee?: string }) {
    const { page, limit, skip } = parsePagination(query, 20, 200);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.status) filter.status = query.status.includes(",") ? { $in: query.status.split(",") } : query.status;
    if (query.employee) filter.employee = query.employee;

    const [records, total] = await Promise.all([
      Confirmation.find(filter).populate(POP).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Confirmation.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await Confirmation.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Confirmation not found"), { statusCode: 404 });
    return record;
  }

  /**
   * Start a confirmation. With `useWorkflow` and a configured chain it goes out
   * for approval; otherwise it confirms the employee immediately.
   */
  async initiate(input: InitiateConfirmationInput, actorId: string) {
    const employee = await Employee.findOne(scoped({ _id: input.employee }));
    if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
    if (employee.status === "terminated") {
      throw Object.assign(new Error("This employee has left the organization"), { statusCode: 400 });
    }
    if (employee.confirmationDate) {
      throw Object.assign(new Error("This employee is already confirmed"), { statusCode: 409 });
    }
    const open = await Confirmation.findOne(scoped({ employee: input.employee, status: "pending" }));
    if (open) throw Object.assign(new Error("A confirmation is already in progress for this employee"), { statusCode: 409 });

    const dueDate = employee.joiningDate && employee.probationPeriodDays
      ? addDays(new Date(employee.joiningDate), employee.probationPeriodDays)
      : null;

    // Only route for approval if one is actually configured — otherwise a
    // "workflow" request would create a record nobody can ever action.
    const workflow = input.useWorkflow ? await beginWorkflowState("confirmations") : null;
    const routed = !!workflow?.approvalSteps.length;

    const doc = await Confirmation.create({
      organization: getOrgId(),
      employee: input.employee,
      dueDate,
      confirmationDate: input.confirmationDate,
      notes: input.notes,
      initiatedBy: actorId,
      ...(routed
        ? { status: "pending", ...workflow }
        : { status: "confirmed", reviewedBy: actorId, reviewedAt: new Date() }),
    });

    if (!routed) await this.applyConfirmation(String(employee._id), input.confirmationDate);

    return Confirmation.findById(doc._id).populate(POP);
  }

  /** Approve or reject an in-flight confirmation. */
  async review(id: string, input: ReviewConfirmationInput, reviewerId: string, reviewerRole: ReviewerRole) {
    const record = await Confirmation.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Confirmation not found"), { statusCode: 404 });
    if (record.status !== "pending") {
      throw Object.assign(new Error("This confirmation has already been decided"), { statusCode: 400 });
    }

    // The subject can't approve their own confirmation.
    const employee = await Employee.findById(record.employee).select("user");
    if (employee?.user) assertNotSelfReview(employee.user, reviewerId);

    const action = input.status === "confirmed" ? "approved" : "rejected";
    const outcome = resolveReviewOutcome(
      record.approvalSteps, record.workflowStep, action, input.reviewNote, reviewerRole
    );
    record.approvalTrail = [...(record.approvalTrail ?? []), outcome.trailEntry];

    if (outcome.advance) {
      // Still pending — waiting on the next step.
      record.workflowStep = (record.workflowStep ?? 1) + 1;
    } else {
      record.status = input.status;
      record.reviewedBy = reviewerId as never;
      record.reviewedAt = new Date();
      if (input.reviewNote) record.reviewNote = input.reviewNote;
      if (input.status === "confirmed") {
        await this.applyConfirmation(String(record.employee), record.confirmationDate);
      }
    }

    await record.save();
    return Confirmation.findById(id).populate(POP);
  }

  /** Withdraw an in-flight confirmation without deciding it. */
  async withdraw(id: string) {
    const record = await Confirmation.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Confirmation not found"), { statusCode: 404 });
    if (record.status !== "pending") {
      throw Object.assign(new Error("Only a pending confirmation can be withdrawn"), { statusCode: 400 });
    }
    await Confirmation.deleteOne({ _id: record._id });
    return { message: "Confirmation withdrawn" };
  }

  /** Stamp the employee as confirmed and take them off probation. */
  private async applyConfirmation(employeeId: string, confirmationDate: Date) {
    const employee = await Employee.findById(employeeId).select("status");
    if (!employee) return;
    const update: Record<string, unknown> = { confirmationDate };
    // Only probation graduates to active — don't disturb notice_period or on_leave.
    if (employee.status === "probation") update.status = "active";
    await Employee.findByIdAndUpdate(employeeId, update);
  }
}
