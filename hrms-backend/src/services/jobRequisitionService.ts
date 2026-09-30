import { JobRequisition } from "../models/JobRequisition.js";
import { Employee } from "../models/Employee.js";
import { ApprovalWorkflow } from "../models/ApprovalWorkflow.js";
import type { CreateRequisitionInput, UpdateRequisitionInput, ReviewRequisitionInput } from "../validations/jobRequisitionValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { parsePagination } from "../utils/query.js";
import { publicUrl, deleteObject } from "./uploadService.js";
import { beginWorkflowState, resolveReviewOutcome, type ReviewerRole } from "./approvalWorkflowService.js";
import { notifyReviewed } from "./reviewNotifier.js";
import { departmentsHeadedBy } from "./departmentHeadService.js";
import { watchersFor } from "./watchers.js";
import { notify } from "./notificationService.js";
import { stillHere } from "../utils/employeeStatus.js";

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

/**
 * A stored requisition with its JD as a link rather than a key.
 *
 * The link is signed and short-lived, so it is minted per response rather
 * than stored — same reasoning as a candidate's CV.
 */
function shape<T extends { jdKey?: string | null }>(doc: T | null, forHead = false) {
  if (!doc) return doc;
  const out: Record<string, unknown> = { ...doc, jdUrl: doc.jdKey ? publicUrl(doc.jdKey) : "" };
  // A head raising a backfill sees who is being replaced, not what they were
  // paid — that salary is HR's, and the requisition would otherwise carry it.
  if (forHead) {
    delete out.replacingSalary;
    const r = out.replacing as Record<string, unknown> | null | undefined;
    if (r && typeof r === "object") { const { salary: _s, ...rest } = r; out.replacing = rest; }
  }
  return out as T & { jdUrl: string };
}

const forbidden = (message: string) => Object.assign(new Error(message), { statusCode: 403 });
const deptOf = (doc: { department?: unknown }) => {
  const d = doc.department as { _id?: unknown } | string | null | undefined;
  return d ? String(typeof d === "object" && d._id ? d._id : d) : "";
};

export class JobRequisitionService {
  /**
   * A department head raising one, rather than someone who holds hiring:
   * only for a department they run, and a backfill only for someone in it.
   * Checked here as well as in the form, since the form is the client's.
   */
  private async assertHeadMayRaise(headUserId: string, department: unknown, replacing: unknown) {
    const heads = await departmentsHeadedBy(headUserId);
    if (!department || !heads.includes(String(department))) {
      throw Object.assign(new Error("Choose a department you head"), { statusCode: 400 });
    }
    if (replacing) {
      const emp = await Employee.findOne(scoped({ _id: replacing })).select("department").lean<{ department?: unknown } | null>();
      if (!emp || !heads.includes(String(emp.department ?? ""))) {
        throw Object.assign(new Error("You can only raise a replacement for someone in your department"), { statusCode: 400 });
      }
    }
    return heads;
  }

  /** The people a head could be replacing: everyone still here in the departments they run. */
  async replaceableFor(headUserId: string) {
    const heads = await departmentsHeadedBy(headUserId);
    if (!heads.length) return [];
    return Employee.find(scoped({ department: { $in: heads }, status: stillHere() }))
      .select("name employeeCode designation department")
      .populate("department", "name")
      .sort({ name: 1 })
      .lean();
  }

  async create(input: CreateRequisitionInput, raisedBy: string, headOnly = false) {
    if (headOnly) await this.assertHeadMayRaise(raisedBy, input.department, input.type === "replacement" ? input.replacing : null);
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
    const created = await JobRequisition.findById(doc._id).populate(POP);

    // Nobody was told a requisition existed until someone opened the page.
    // Whoever can decide hiring is, the same set the approvals inbox draws on.
    if (doc.status === "pending") {
      const raiser = (created as unknown as { raisedBy?: { name?: string } })?.raisedBy?.name ?? "Someone";
      const dept = (created as unknown as { department?: { name?: string } })?.department?.name;
      watchersFor("hiring", raisedBy)
        .then((users) => notify({
          users,
          kind: "approval",
          title: `New requisition: ${input.title}`,
          body: `${raiser}${dept ? ` (${dept})` : ""} — ${TYPE_LABELS[input.type] ?? input.type}, ${input.headcount ?? 1} position${(input.headcount ?? 1) === 1 ? "" : "s"}`,
          href: `/hiring/${doc._id}`,
          actor: raisedBy,
        }))
        .catch(() => null);
    }
    return shape(created!.toObject(), headOnly);
  }

  /**
   * `restrictToUserId` is set for a department head without the hiring
   * permission: their own departments' requisitions and nothing else,
   * whatever department the query asks for.
   */
  async list(query: RequisitionQuery, restrictToUserId?: string) {
    const { page, limit, skip } = parsePagination(query, 20, 100);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.status) filter.status = query.status;
    if (query.type) filter.type = query.type;
    if (restrictToUserId) {
      const heads = await departmentsHeadedBy(restrictToUserId);
      if (!heads.length) return { records: [], pagination: buildPagination(0, page, limit) };
      filter.department = { $in: heads };
    } else if (query.department) filter.department = query.department;
    if (query.raisedBy) filter.raisedBy = query.raisedBy;
    if (query.search) filter.title = { $regex: String(query.search).trim(), $options: "i" };

    const sortable = new Set(["createdAt", "targetStartDate", "status", "title"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "createdAt";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      JobRequisition.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit).lean(),
      JobRequisition.countDocuments(filter),
    ]);
    return { records: records.map((r) => shape(r, !!restrictToUserId)), pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string, restrictToUserId?: string) {
    const record = await JobRequisition.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    if (restrictToUserId) {
      const heads = await departmentsHeadedBy(restrictToUserId);
      if (!heads.includes(deptOf(record))) throw forbidden("That requisition is not for a department you head");
    }
    return shape(record.toObject(), !!restrictToUserId);
  }

  /**
   * A head may change a requisition only if they raised it and it is still
   * one of their departments' — the rest of the checks (still pending, nobody
   * approved a step yet) apply to everybody in update().
   */
  async assertHeadMayEdit(id: string, headUserId: string) {
    const record = await JobRequisition.findOne(scoped({ _id: id })).select("raisedBy department").lean<{ raisedBy?: unknown; department?: unknown } | null>();
    if (!record) throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    const heads = await departmentsHeadedBy(headUserId);
    if (String(record.raisedBy) !== String(headUserId) || !heads.includes(deptOf(record))) {
      throw forbidden("Only the requisitions you raised for your own department can be changed");
    }
    return heads;
  }

  /**
   * Edit the details. Cannot change status — see review().
   *
   * Only while pending: once anyone has approved a step, the figures they
   * agreed to are part of the record, and changing them underneath would make
   * the trail a record of a decision nobody actually took.
   */
  async update(id: string, input: UpdateRequisitionInput, headOnly?: string) {
    if (headOnly) {
      await this.assertHeadMayEdit(id, headOnly);
      const current = await JobRequisition.findOne(scoped({ _id: id })).select("department type replacing").lean<Record<string, unknown> | null>();
      const type = (input as { type?: string }).type ?? current?.type;
      await this.assertHeadMayRaise(
        headOnly,
        input.department !== undefined ? input.department : current?.department,
        type === "replacement" ? ((input as { replacing?: unknown }).replacing ?? current?.replacing) : null
      );
    }
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
    const updated = await JobRequisition.findById(id).populate(POP);
    return shape(updated!.toObject(), !!headOnly);
  }

  /**
   * Attach a JD file, or replace the one already there.
   *
   * A prior attachment is deleted from storage rather than left orphaned — the
   * same rule a candidate's CV follows.
   */
  async setJd(id: string, key: string, fileName: string, forHead = false) {
    const record = await JobRequisition.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    if (record.jdKey) await deleteObject(record.jdKey);
    record.jdKey = key;
    record.jdFileName = fileName;
    await record.save();
    const updated = await JobRequisition.findById(id).populate(POP);
    return shape(updated!.toObject(), forHead);
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

    const reviewed = await JobRequisition.findById(id).populate(POP);
    return shape(reviewed!.toObject());
  }

  async remove(id: string) {
    const record = await JobRequisition.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    if (record.jdKey) await deleteObject(record.jdKey);
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
