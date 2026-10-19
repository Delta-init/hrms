import mongoose from "mongoose";
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
import { env } from "../config/env.js";

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

/**
 * Whether finance decides the requisitions that need accounts.
 *
 * Read on every call rather than once at boot, so it is the deployed value that
 * decides — and only the exact word "on" turns it on, so a stray "true" or
 * "yes" leaves HR's approval final rather than parking requests with a finance
 * side that may not be reading them yet.
 */
export const hiringFinanceStepOn = () => env.HIRING_FINANCE_STEP === "on";

const STATUS_WORDS: Record<string, string> = { finance_pending: "waiting for finance" };

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

const FINANCE_POP = [
  { path: "raisedBy", select: "name email" },
  { path: "department", select: "name" },
  { path: "replacing", select: "name designation salary" },
  { path: "approvalTrail.by", select: "name" },
] as const;

/**
 * One requisition as finance reads it — the integration contract, so its field
 * names are fixed. `replacing.salary` is the figure frozen when it was raised
 * (the one the budget check compared against), falling back to the leaver's
 * current salary only when none was frozen.
 */
function forFinance(r: Record<string, unknown>) {
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);
  const raiser = obj(r.raisedBy);
  const dept = obj(r.department);
  const rep = obj(r.replacing);
  const trail = (r.approvalTrail ?? []) as Array<{ action?: string; at?: Date; by?: unknown }>;
  const hr = [...trail].reverse().find((t) => t.action === "approved");
  return {
    _id: r._id,
    title: r.title,
    type: r.type,
    headcount: r.headcount ?? 1,
    salaryMin: r.salaryMin ?? null,
    salaryMax: r.salaryMax ?? null,
    currency: r.currency ?? "AED",
    department: dept ? { name: String(dept.name ?? "") } : null,
    designation: r.designation ?? "",
    location: r.location ?? "",
    employmentType: r.employmentType ?? "",
    justification: r.justification ?? "",
    targetStartDate: r.targetStartDate ?? null,
    jdText: r.jdText ?? "",
    jdFileName: r.jdKey ? (r.jdFileName ?? "") : "",
    // Signed and short-lived, minted per response — the same link the page uses.
    jdUrl: r.jdKey ? publicUrl(String(r.jdKey)) : "",
    raisedBy: { name: String(raiser?.name ?? ""), email: String(raiser?.email ?? "") },
    replacing: rep
      ? { name: String(rep.name ?? ""), designation: String(rep.designation ?? ""), salary: (r.replacingSalary as number | null) ?? (rep.salary as number | undefined) ?? null }
      : null,
    hrApprovedAt: hr?.at ?? r.updatedAt ?? null,
    hrApprovedBy: String(obj(hr?.by)?.name ?? ""),
    createdAt: r.createdAt,
  };
}

const forbidden = (message: string) => Object.assign(new Error(message), { statusCode: 403 });

/**
 * The login of whoever a replacement requisition would backfill. They are
 * never told about their own replacement and never shown it — strictly, in
 * every alert, list and queue — so this is the one name every notice is
 * filtered against.
 */
export async function replacedUserId(replacing: unknown): Promise<string | null> {
  if (!replacing) return null;
  const id = (replacing as { _id?: unknown })?._id ?? replacing;
  const emp = await Employee.findById(id).select("user").lean<{ user?: unknown } | null>();
  return emp?.user ? String(emp.user) : null;
}

/** Every employee record a login stands for — what "replacing" would point at. */
export async function employeeIdsOf(userId: string): Promise<mongoose.Types.ObjectId[]> {
  const rows = await Employee.find({ user: userId }).select("_id").lean<Array<{ _id: mongoose.Types.ObjectId }>>();
  return rows.map((r) => r._id);
}

const without = (users: string[], excluded: string | null) => (excluded ? users.filter((u) => String(u) !== excluded) : users);
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
      const hidden = await replacedUserId(doc.replacing);
      watchersFor("hiring", raisedBy)
        .then((users) => notify({
          users: without(users, hidden),
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
  async list(query: RequisitionQuery, restrictToUserId?: string, viewerUserId?: string) {
    const { page, limit, skip } = parsePagination(query, 20, 100);

    const filter: Record<string, unknown> = { ...orgFilter() };
    // Never the requisition that replaces the person looking.
    if (viewerUserId) {
      const mine = await employeeIdsOf(viewerUserId);
      if (mine.length) filter.replacing = { $nin: mine };
    }
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

  async getById(id: string, restrictToUserId?: string, viewerUserId?: string) {
    const record = await JobRequisition.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    if (viewerUserId) await this.assertNotAbout(record, viewerUserId);
    if (restrictToUserId) {
      const heads = await departmentsHeadedBy(restrictToUserId);
      if (!heads.includes(deptOf(record))) throw forbidden("That requisition is not for a department you head");
    }
    return shape(record.toObject(), !!restrictToUserId);
  }

  /**
   * The requisition replacing the person asking does not exist, as far as they
   * can tell — the same "not found" as an id that was never there.
   */
  async assertNotAbout(record: { replacing?: unknown } | string, viewerUserId: string) {
    const doc = typeof record === "string"
      ? await JobRequisition.findOne(scoped({ _id: record })).select("replacing").lean<{ replacing?: unknown } | null>()
      : record;
    if (!doc) throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    if ((await replacedUserId(doc.replacing)) === String(viewerUserId)) {
      throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    }
  }

  /**
   * Withdraw a requisition before it is decided — pending, part-way through
   * its approvals, or waiting for finance. The one who raised it may, and so
   * may anyone holding hiring edit. It leaves every queue (finance's too: a
   * decision sent for it afterwards is refused) and stays on record as
   * withdrawn, with who and why. Approvers hear in-app; the person it would
   * have replaced never does.
   */
  async withdraw(id: string, actor: { userId: string; canEdit: boolean }, reason = "") {
    const record = await JobRequisition.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    await this.assertNotAbout(record, actor.userId);
    if (String(record.raisedBy) !== String(actor.userId) && !actor.canEdit) {
      throw forbidden("Only the person who raised it, or HR, can withdraw this requisition");
    }
    if (!["draft", "pending", "finance_pending", "on_hold"].includes(record.status)) {
      throw Object.assign(
        new Error(`This requisition has already been ${record.status === "cancelled" ? "withdrawn or cancelled" : record.status} and can no longer be withdrawn`),
        { statusCode: 400 }
      );
    }
    record.status = "cancelled";
    record.withdrawnAt = new Date();
    record.withdrawnBy = actor.userId as never;
    record.withdrawReason = reason;
    await record.save();

    const hidden = await replacedUserId(record.replacing);
    const users = without(await watchersFor("hiring", String(record.raisedBy)), hidden)
      .concat(String(record.raisedBy) !== String(actor.userId) ? [String(record.raisedBy)] : []);
    await notify({
      users,
      kind: "approval",
      title: `Requisition withdrawn: ${record.title}`,
      body: reason || "No longer needed",
      href: "/hiring",
      actor: actor.userId,
    }).catch(() => null);

    const updated = await JobRequisition.findById(id).populate(POP);
    return shape(updated!.toObject(), !actor.canEdit);
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
  async update(id: string, input: UpdateRequisitionInput, headOnly?: string, viewerUserId?: string) {
    if (viewerUserId) await this.assertNotAbout(id, viewerUserId);
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
        new Error(record.status === "finance_pending"
          ? "This requisition is waiting for finance and can no longer be edited"
          : `This requisition has already been ${record.status} and can no longer be edited`),
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
    await this.assertNotAbout(id, reviewerId);
    const record = await JobRequisition.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    if (record.status !== "pending") {
      throw Object.assign(new Error("This requisition has already been reviewed"), { statusCode: 400 });
    }

    if (input.reviewNote !== undefined) record.reviewNote = input.reviewNote ?? undefined;

    const outcome = resolveReviewOutcome(
      record.approvalSteps, record.workflowStep, input.status, input.reviewNote, reviewerRole
    );
    // `by` is the person who decided. resolveReviewOutcome fills it from the
    // reviewer's role, which the trail's User ref cannot name — and finance is
    // told who approved this here, so it has to be the person.
    record.approvalTrail = [...(record.approvalTrail ?? []), { ...outcome.trailEntry, by: reviewerId as never }];
    // HR's approval is the last word here, unless finance has to see it: then
    // the request waits on finance (HIRING_FINANCE_STEP=on), which decides it
    // in the finance system — see recordFinanceDecision(). The trail entry
    // above still records who approved it here.
    const toFinance = !outcome.advance && input.status === "approved" && record.budgetApprovalRequired && hiringFinanceStepOn();
    if (outcome.advance) {
      record.workflowStep = (record.workflowStep ?? 1) + 1;
    } else if (toFinance) {
      record.status = "finance_pending";
    } else {
      record.status = input.status;
      if (input.status === "rejected") record.rejectedBy = "hr";
    }
    await record.save();

    if (toFinance) {
      // Not an outcome yet — the raiser hears the real one when finance decides.
      // One line in-app so the request does not look stuck; no mail.
      await notify({
        users: [record.raisedBy],
        kind: "approval",
        title: `Hiring requisition approved by HR — waiting for finance`,
        body: `${record.title} · ${TYPE_LABELS[record.type] ?? record.type}`,
        href: "/hiring",
        actor: reviewerId,
      });
    }

    // Only once the decision is final. An intermediate approval is not an
    // outcome, and telling somebody twice about one request is worse than late.
    if (!outcome.advance && !toFinance) {
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
      // Finance decides the ones that need accounts, whatever the chain says.
      financeStep: hiringFinanceStepOn(),
      steps: (workflow?.steps ?? []).map((s) => ({
        order: s.order,
        when: s.when ?? "always",
        roleName: (s.role as { roleName?: string })?.roleName ?? "",
        label: s.label,
      })),
    };
  }

  // ── Finance integration ────────────────────────────────────────────────────
  // Finance never logs in here. Its half arrives from the finance system over
  // the integration API, named by organization because a machine request has
  // no user to infer one from — the same shape as salary advances.

  /** Requisitions HR approved that need accounts, waiting on finance. Newest first. */
  async listForFinance(organization: string) {
    const rows = await JobRequisition.find({ organization, status: "finance_pending" })
      .populate([...FINANCE_POP])
      .sort({ createdAt: -1 })
      .lean();
    return rows.map((r) => forFinance(r as unknown as Record<string, unknown>));
  }

  /**
   * Finance's decision. Approved means recruiting may start; refused needs a
   * note, since the raiser is told and has nothing else to go on.
   *
   * A repeat of the decision finance already made — a retry after a lost
   * response — answers with the record rather than refusing, so finance can
   * safely send again. Anything else not waiting on finance is a 409.
   */
  async recordFinanceDecision(
    organization: string,
    id: string,
    input: { decision: "approve" | "reject"; note?: string | null; by?: string | null }
  ) {
    const notFound = () => Object.assign(new Error("Requisition not found"), { statusCode: 404 });
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const record = await JobRequisition.findOne({ _id: id, organization });
    if (!record) throw notFound();

    const approve = input.decision === "approve";
    const repeat = record.financeReviewedAt
      && ((approve && record.status === "approved") || (!approve && record.status === "rejected" && record.rejectedBy === "finance"));
    if (!repeat) {
      if (record.status !== "finance_pending") {
        throw Object.assign(
          new Error(`Only a requisition waiting for finance can be decided there — this one is ${STATUS_WORDS[record.status] ?? record.status}`),
          { statusCode: 409 }
        );
      }
      const note = String(input.note ?? "").trim();
      if (!approve && note.length < 3) {
        throw Object.assign(new Error("A note (at least 3 characters) is required to refuse a requisition"), { statusCode: 400 });
      }

      record.status = approve ? "approved" : "rejected";
      record.rejectedBy = approve ? null : "finance";
      record.financeReviewedAt = new Date();
      record.financeNote = note.slice(0, 1000);
      record.financeReviewedBy = String(input.by ?? "").trim().slice(0, 120);
      await record.save();

      // Finance is waiting on this answer; the notice can follow it.
      this.announceFinanceDecision(record).catch((err) =>
        console.error(`hiring: could not announce finance's decision on ${record._id}:`, err instanceof Error ? err.message : err)
      );
    }

    const saved = await JobRequisition.findById(record._id).populate([...FINANCE_POP]).lean();
    const r = saved as unknown as Record<string, unknown>;
    return {
      ...forFinance(r),
      status: r.status,
      financeReviewedAt: r.financeReviewedAt ?? null,
      financeNote: r.financeNote ?? "",
      financeReviewedBy: r.financeReviewedBy ?? "",
      rejectedBy: r.rejectedBy ?? null,
    };
  }

  /** The raiser hears the outcome; whoever decides hiring sees it in-app. */
  private async announceFinanceDecision(record: {
    _id: unknown; raisedBy: unknown; title: string; type: string; headcount: number; status: string;
    salaryMax?: number; currency?: string; financeNote?: string; financeReviewedBy?: string;
  }) {
    const details = [
      { label: "Role", value: record.title },
      { label: "Type", value: TYPE_LABELS[record.type] ?? record.type },
      { label: "Headcount", value: String(record.headcount) },
    ];
    if (record.salaryMax) details.push({ label: "Budget", value: `up to ${record.currency ?? ""} ${record.salaryMax}`.trim() });
    await notifyReviewed({
      userId: record.raisedBy,
      subject: "Hiring requisition",
      approved: record.status === "approved",
      details,
      note: record.financeNote || null,
      path: "/hiring",
      kind: "approval",
      reviewer: { id: null, name: record.financeReviewedBy ? `finance (${record.financeReviewedBy})` : "finance" },
      watchers: without(await watchersFor("hiring", String(record.raisedBy)).catch(() => []), await replacedUserId((record as { replacing?: unknown }).replacing)),
    });
  }
}
