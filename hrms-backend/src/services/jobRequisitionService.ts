import { JobRequisition } from "../models/JobRequisition.js";
import { Employee } from "../models/Employee.js";
import { ApprovalWorkflow } from "../models/ApprovalWorkflow.js";
import type { CreateRequisitionInput, UpdateRequisitionInput, ReviewRequisitionInput } from "../validations/jobRequisitionValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { parsePagination } from "../utils/query.js";
import { beginWorkflowState, resolveReviewOutcome, type ReviewerRole } from "./approvalWorkflowService.js";
import { notifyReviewed } from "./reviewNotifier.js";

/**
 * Requests to fill a role, and the approvals they clear before recruiting
 * starts.
 *
 * The chain itself is the organization's configured one — this module owns no
 * approval logic of its own beyond deciding whether the budget step applies.
 */

const POP = [
  { path: "raisedBy", select: "name email" },
  { path: "department", select: "name" },
  { path: "replacing", select: "name employeeCode designation salary" },
];

const TYPE_LABELS: Record<string, string> = {
  replacement: "Replacement",
  new_headcount: "New headcount",
};

/**
 * Whether Finance has to see this.
 *
 * New headcount always: a position that did not exist is unbudgeted by
 * definition. A replacement only when it costs more than the person leaving —
 * a like-for-like backfill is already in the budget, and routing it to Finance
 * is friction that teaches people to route around the process.
 *
 * Compared against the highest figure asked for, not the lowest: the request is
 * for permission to offer up to that, and that is the number that has to be
 * affordable.
 *
 * When the comparison cannot be made — no budget named, or no salary on record
 * for the person leaving — this fails closed and sends it to Finance. Failing
 * open would make "leave the budget blank" a way to skip the control, and most
 * employees here have no salary recorded, so it would not even take intent.
 */
export function requiresBudgetApproval(
  type: string,
  proposedMax: number | undefined | null,
  replacingSalary: number | undefined | null
): boolean {
  if (type === "new_headcount") return true;
  if (!proposedMax || !replacingSalary) return true;
  return proposedMax > replacingSalary;
}

interface RequisitionQuery extends PaginationQuery {
  type?: string;
  department?: string;
  raisedBy?: string;
}

export class JobRequisitionService {
  async create(input: CreateRequisitionInput, raisedBy: string) {
    // Frozen at creation. Salaries move, and a trail that cannot be re-derived
    // months later is not a trail.
    let replacingSalary: number | null = null;
    if (input.type === "replacement" && input.replacing) {
      const outgoing = await Employee.findOne(scoped({ _id: input.replacing })).select("salary").lean<{ salary?: number } | null>();
      if (!outgoing) throw Object.assign(new Error("The employee being replaced was not found"), { statusCode: 404 });
      replacingSalary = outgoing.salary ?? null;
    }

    const budgetApprovalRequired = requiresBudgetApproval(input.type, input.salaryMax, replacingSalary);
    const workflow = await beginWorkflowState("hiring", { budget_increase: budgetApprovalRequired });

    const doc = await JobRequisition.create({
      ...input,
      replacing: input.type === "replacement" ? input.replacing ?? null : null,
      replacingSalary,
      budgetApprovalRequired,
      organization: getOrgId(),
      raisedBy,
      status: input.status ?? "pending",
      ...workflow,
    });
    return JobRequisition.findById(doc._id).populate(POP);
  }

  async list(query: RequisitionQuery) {
    const { page, limit, skip } = parsePagination(query, 20, 100);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.status) filter.status = query.status;
    if (query.type) filter.type = query.type;
    if (query.department) filter.department = query.department;
    if (query.raisedBy) filter.raisedBy = query.raisedBy;
    if (query.search) filter.title = { $regex: String(query.search).trim(), $options: "i" };

    const sortable = new Set(["createdAt", "targetStartDate", "status", "title"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "createdAt";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      JobRequisition.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit).lean(),
      JobRequisition.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await JobRequisition.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    return record;
  }

  /**
   * Edit the details. Cannot change status — see review().
   *
   * Only while pending: once anyone has approved a step, the figures they
   * agreed to are part of the record, and changing them underneath would make
   * the trail a record of a decision nobody actually took.
   */
  async update(id: string, input: UpdateRequisitionInput) {
    const record = await JobRequisition.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    if (record.status !== "pending" && record.status !== "draft") {
      throw Object.assign(
        new Error(`This requisition has already been ${record.status} and can no longer be edited`),
        { statusCode: 400 }
      );
    }
    if ((record.approvalTrail ?? []).length > 0) {
      throw Object.assign(
        new Error("Someone has already approved a step on this requisition. Cancel it and raise a new one."),
        { statusCode: 400 }
      );
    }

    Object.assign(record, input);
    await record.save();
    return JobRequisition.findById(id).populate(POP);
  }

  /** Approve or reject at the current step. */
  async review(id: string, input: ReviewRequisitionInput, reviewerId: string, reviewerRole: ReviewerRole) {
    const record = await JobRequisition.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    if (record.status !== "pending") {
      throw Object.assign(new Error("This requisition has already been reviewed"), { statusCode: 400 });
    }

    if (input.reviewNote !== undefined) record.reviewNote = input.reviewNote ?? undefined;

    const outcome = resolveReviewOutcome(
      record.approvalSteps, record.workflowStep, input.status, input.reviewNote, reviewerRole
    );
    record.approvalTrail = [...(record.approvalTrail ?? []), outcome.trailEntry];
    if (outcome.advance) {
      record.workflowStep = (record.workflowStep ?? 1) + 1;
    } else {
      record.status = input.status;
    }
    await record.save();

    // Only once the decision is final. An intermediate approval is not an
    // outcome, and telling somebody twice about one request is worse than late.
    if (!outcome.advance) {
      const details = [
        { label: "Role", value: record.title },
        { label: "Type", value: TYPE_LABELS[record.type] ?? record.type },
        { label: "Headcount", value: String(record.headcount) },
      ];
      if (record.salaryMax) {
        details.push({ label: "Budget", value: `up to ${record.currency ?? ""} ${record.salaryMax}`.trim() });
      }
      await notifyReviewed({
        userId: record.raisedBy,
        subject: "Hiring requisition",
        approved: record.status === "approved",
        details,
        note: record.reviewNote,
        path: "/hiring",
      });
    }

    return JobRequisition.findById(id).populate(POP);
  }

  async remove(id: string) {
    const record = await JobRequisition.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    return { message: "Requisition deleted successfully" };
  }

  /**
   * Whether the organization has actually configured a hiring chain.
   *
   * Without one every approvable module falls back to single-step, so the
   * Finance gate would silently not exist — the page says so rather than
   * letting somebody believe a control is in force when it is not.
   */
  async workflowState() {
    const workflow = await ApprovalWorkflow.findOne(scoped({ module: "hiring" }))
      .populate<{ steps: Array<{ order: number; when?: string; role: { roleName: string }; label?: string }> }>("steps.role", "roleName")
      .lean();
    return {
      configured: !!workflow?.enabled && (workflow?.steps?.length ?? 0) > 0,
      steps: (workflow?.steps ?? []).map((s) => ({
        order: s.order,
        when: s.when ?? "always",
        roleName: (s.role as { roleName?: string })?.roleName ?? "",
        label: s.label,
      })),
    };
  }
}
