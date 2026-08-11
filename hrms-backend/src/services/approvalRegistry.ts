import type { Model } from "mongoose";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Regularization } from "../models/Regularization.js";
import { Reimbursement } from "../models/Reimbursement.js";
import { Confirmation } from "../models/Confirmation.js";
import { JobRequisition } from "../models/JobRequisition.js";
import { Resignation } from "../models/Resignation.js";
import { Application } from "../models/Application.js";
import { LeaveService } from "./leaveService.js";
import { RegularizationService } from "./regularizationService.js";
import { ReimbursementService } from "./reimbursementService.js";
import { ConfirmationService } from "./confirmationService.js";
import { JobRequisitionService } from "./jobRequisitionService.js";
import { ResignationService } from "./resignationService.js";
import { CandidateService } from "./candidateService.js";
import type { ReviewerRole } from "./approvalWorkflowService.js";

/**
 * Every kind of thing that can be waiting on somebody, in one list.
 *
 * Deliberately a reader over the seven modules rather than a table they all
 * write into. A second copy of "is this still pending" goes stale the first
 * time a record is updated by a path that does not know about it, and each of
 * these modules already owns rules — a regularization writes an attendance
 * record on approval, a reimbursement allocates a recovery — that a shortcut
 * would skip.
 *
 * So deciding here dispatches to the module's own review method. This file
 * knows how to find things and how to describe them; it decides nothing.
 */

export type ApprovalModule =
  | "leave" | "regularization" | "reimbursement" | "confirmation"
  | "hiring" | "offer" | "resignation";

/** What was decided about a request, once somebody has decided it. */
export interface Decision {
  outcome: "approved" | "rejected";
  at: Date | null;
  by: { id: string | null; name: string } | null;
  note: string | null;
}

export interface ApprovalRow {
  id: string;
  module: ApprovalModule;
  moduleLabel: string;
  organization: { id: string | null; name: string | null };
  title: string;
  raisedBy: { id: string | null; name: string } | null;
  raisedAt: Date | null;
  /** Module-specific detail lines, so one row can describe seven shapes. */
  summary: Array<{ label: string; value: string }>;
  /** Where it is in its chain, or null when the module has none configured. */
  chain: { step: number; total: number; waitingOn: string } | null;
  /** Deep link to the record in its own module. */
  href: string;
  /** Only on the decided view. */
  decided?: Decision | null;
}

/**
 * The other half of an inbox: what was already decided, and by whom.
 *
 * Every module records this differently — five keep `reviewedBy`/`reviewedAt`,
 * an offer keeps its own `offerApproval` block, and a requisition keeps a whole
 * trail — so each adapter says where to look rather than the reader guessing.
 */
interface DecidedConfig {
  filter: Record<string, unknown>;
  /** The field the decision is dated on: sorted and date-filtered on. */
  dateField: string;
  /** Extra populates only this view needs — the reviewer's name. */
  populate: Array<Record<string, unknown>>;
  outcome: (doc: Record<string, never>) => Decision;
}

interface Adapter {
  module: ApprovalModule;
  label: string;
  model: Model<never>;
  /** What "still waiting" means for this module. */
  pendingFilter: Record<string, unknown>;
  populate: Array<Record<string, unknown>>;
  decided: DecidedConfig;
  /** One record to one row. */
  toRow: (doc: Record<string, never>) => Omit<ApprovalRow, "module" | "moduleLabel" | "organization">;
  decide: (id: string, approve: boolean, note: string | undefined, userId: string, role: ReviewerRole) => Promise<unknown>;
}

const leave = new LeaveService();
const regularization = new RegularizationService();
const reimbursement = new ReimbursementService();
const confirmation = new ConfirmationService();
const requisition = new JobRequisitionService();
const resignation = new ResignationService();
const candidates = new CandidateService();

const name = (v: unknown): string =>
  v && typeof v === "object" ? String((v as { name?: string }).name ?? "—") : "—";
/** Not everything populated is a person: a requisition is titled, not named. */
const label = (v: unknown): string =>
  v && typeof v === "object"
    ? String((v as { name?: string; title?: string }).name ?? (v as { title?: string }).title ?? "—")
    : "—";
const idOf = (v: unknown): string | null =>
  v && typeof v === "object" ? String((v as { _id?: unknown })._id ?? "") : v ? String(v) : null;
const day = (d: unknown): string =>
  d ? new Date(d as string).toISOString().slice(0, 10) : "—";
const person = (v: unknown) => (v ? { id: idOf(v), name: name(v) } : null);

const decision = (approve: boolean) => (approve ? "approved" : "rejected") as "approved" | "rejected";

/**
 * Five of the seven record a decision identically. `approvedWhen` lists the
 * statuses that mean yes, because they do not all call it "approved" — a
 * confirmation is "confirmed", a resignation "accepted", and a reimbursement
 * that has since been paid was approved first.
 */
const reviewedDecision = (approvedWhen: string[]): Omit<DecidedConfig, "filter"> => ({
  dateField: "reviewedAt",
  populate: [{ path: "reviewedBy", select: "name" }],
  outcome: (d): Decision => ({
    outcome: approvedWhen.includes(String(d.status)) ? "approved" : "rejected",
    at: (d.reviewedAt as Date) ?? null,
    by: person(d.reviewedBy),
    note: (d.reviewNote as string) ?? null,
  }),
});

export const ADAPTERS: Adapter[] = [
  {
    module: "leave",
    label: "Leave",
    model: LeaveRequest as never,
    pendingFilter: { status: "pending" },
    populate: [{ path: "user", select: "name email" }],
    // Cancelled is the employee withdrawing it, not a decision anybody made.
    decided: { filter: { status: { $in: ["approved", "rejected"] } }, ...reviewedDecision(["approved"]) },
    toRow: (d) => ({
      id: String(d._id),
      title: `${String(d.type ?? "Leave").replace(/_/g, " ")} — ${d.days ?? "?"} day${d.days === 1 ? "" : "s"}`,
      raisedBy: person(d.user),
      raisedAt: (d.createdAt as Date) ?? null,
      summary: [
        { label: "From", value: day(d.startDate) },
        { label: "To", value: day(d.endDate) },
        { label: "Reason", value: String(d.reason ?? "—") },
      ],
      chain: null,
      href: "/leave",
    }),
    decide: (id, approve, note, userId, role) =>
      leave.review(id, { status: decision(approve), reviewNote: note } as never, userId, role),
  },
  {
    module: "regularization",
    label: "Regularization",
    model: Regularization as never,
    pendingFilter: { status: "pending" },
    populate: [{ path: "user", select: "name email" }],
    decided: { filter: { status: { $in: ["approved", "rejected"] } }, ...reviewedDecision(["approved"]) },
    toRow: (d) => ({
      id: String(d._id),
      title: `${String(d.type ?? "Correction").replace(/_/g, " ")} — ${day(d.date)}`,
      raisedBy: person(d.user),
      raisedAt: (d.createdAt as Date) ?? null,
      summary: [
        { label: "Day", value: day(d.date) },
        { label: "Becomes", value: String(d.resultingStatus ?? "present").replace(/_/g, " ") },
        { label: "Reason", value: String(d.reason ?? "—") },
      ],
      chain: null,
      href: "/regularization",
    }),
    decide: (id, approve, note, userId, role) =>
      regularization.review(id, { status: decision(approve), reviewNote: note } as never, userId, role),
  },
  {
    module: "reimbursement",
    label: "Reimbursement",
    model: Reimbursement as never,
    pendingFilter: { status: "pending" },
    populate: [{ path: "user", select: "name email" }],
    // "Paid" is downstream of approval, so it belongs in the history too.
    decided: {
      filter: { status: { $in: ["approved", "rejected", "paid"] } },
      ...reviewedDecision(["approved", "paid"]),
    },
    toRow: (d) => ({
      id: String(d._id),
      // A reimbursement carries no currency of its own — it is always claimed
      // in the organisation's, so printing an empty one left a hole in the row.
      title: `${String(d.title ?? "Claim")} — ${d.amount ?? 0}`,
      raisedBy: person(d.user),
      raisedAt: (d.createdAt as Date) ?? null,
      summary: [
        { label: "Amount", value: String(d.amount ?? 0) },
        { label: "Spent on", value: day(d.expenseDate) },
        { label: "Category", value: String(d.category ?? "—") },
      ],
      chain: null,
      href: "/reimbursements",
    }),
    decide: (id, approve, note, userId, role) =>
      reimbursement.review(id, { status: decision(approve), reviewNote: note } as never, userId, role),
  },
  {
    module: "confirmation",
    label: "Confirmation",
    model: Confirmation as never,
    pendingFilter: { status: "pending" },
    populate: [{ path: "employee", select: "name employeeCode" }],
    decided: {
      filter: { status: { $in: ["confirmed", "rejected"] } },
      ...reviewedDecision(["confirmed"]),
    },
    toRow: (d) => ({
      id: String(d._id),
      title: `Confirm ${name(d.employee)}`,
      raisedBy: person(d.employee),
      raisedAt: (d.createdAt as Date) ?? null,
      summary: [
        // Probation ended on the first date; the second is when confirming
        // takes effect, which HR can back- or forward-date. A reviewer needs
        // both — the gap between them is the whole question.
        { label: "Probation ended", value: day(d.dueDate) },
        { label: "Effective", value: day(d.confirmationDate) },
        { label: "Notes", value: String(d.notes ?? "—") },
      ],
      chain: null,
      href: "/confirmations",
    }),
    // Not "approved": a confirmation is "confirmed", and the service branches on
    // that word — passing the wrong one both failed the enum and wrote a
    // rejection into the trail while claiming to approve.
    decide: (id, approve, note, userId, role) =>
      confirmation.review(id, { status: approve ? "confirmed" : "rejected", reviewNote: note } as never, userId, role),
  },
  {
    module: "hiring",
    label: "Hiring requisition",
    model: JobRequisition as never,
    pendingFilter: { status: "pending" },
    populate: [{ path: "raisedBy", select: "name email" }, { path: "department", select: "name" }],
    // The only one with no `reviewedAt`: its decision lives in the trail, which
    // is the exact record. `updatedAt` is only what the list is sorted and
    // date-filtered on, since Mongo cannot sort on the last element of an array.
    decided: {
      filter: { status: { $in: ["approved", "rejected"] } },
      dateField: "updatedAt",
      populate: [{ path: "approvalTrail.by", select: "name" }],
      outcome: (d): Decision => {
        const trail = (d.approvalTrail ?? []) as Array<{ by?: unknown; note?: string; at?: Date }>;
        const last = trail[trail.length - 1];
        return {
          outcome: d.status === "approved" ? "approved" : "rejected",
          at: last?.at ?? (d.updatedAt as Date) ?? null,
          by: last?.by ? person(last.by) : null,
          note: last?.note ?? (d.reviewNote as string) ?? null,
        };
      },
    },
    toRow: (d) => ({
      id: String(d._id),
      title: `${String(d.title ?? "Role")} — ${d.headcount ?? 1} position${d.headcount === 1 ? "" : "s"}`,
      raisedBy: person(d.raisedBy),
      raisedAt: (d.createdAt as Date) ?? null,
      summary: [
        { label: "Type", value: String(d.type ?? "").replace(/_/g, " ") },
        { label: "Department", value: name(d.department) },
        { label: "Budget", value: d.salaryMax ? `up to ${d.currency ?? ""} ${d.salaryMax}`.trim() : "—" },
        { label: "Accounts", value: d.budgetApprovalRequired ? "required" : "not required" },
      ],
      chain: null,
      href: "/hiring",
    }),
    decide: (id, approve, note, userId, role) =>
      requisition.review(id, { status: decision(approve), reviewNote: note } as never, userId, role),
  },
  {
    module: "offer",
    label: "Offer release",
    model: Application as never,
    // The only one keyed on a nested field rather than the record's own status.
    pendingFilter: { "offerApproval.status": "pending" },
    populate: [
      { path: "candidate", select: "name email currency expectedSalary" },
      { path: "requisition", select: "title" },
      // Without this the row cannot say who asked for the offer — the only
      // field on it that is not on the record's own top level.
      { path: "offerApproval.requestedBy", select: "name email" },
    ],
    decided: {
      filter: { "offerApproval.status": { $in: ["approved", "rejected"] } },
      dateField: "offerApproval.decidedAt",
      populate: [{ path: "offerApproval.decidedBy", select: "name" }],
      outcome: (d): Decision => {
        const o = (d.offerApproval ?? {}) as { status?: string; decidedAt?: Date; decidedBy?: unknown; note?: string };
        return {
          outcome: o.status === "approved" ? "approved" : "rejected",
          at: o.decidedAt ?? null,
          by: o.decidedBy ? person(o.decidedBy) : null,
          note: o.note ?? null,
        };
      },
    },
    toRow: (d) => ({
      id: String(d._id),
      title: `Offer to ${name(d.candidate)}`,
      raisedBy: person((d.offerApproval as { requestedBy?: unknown } | undefined)?.requestedBy),
      raisedAt: ((d.offerApproval as { requestedAt?: Date } | undefined)?.requestedAt) ?? null,
      summary: [
        { label: "Role", value: label(d.requisition) },
        { label: "Offering", value: d.offeredSalary ? String(d.offeredSalary) : "—" },
        { label: "They expect", value: String((d.candidate as { expectedSalary?: number } | undefined)?.expectedSalary ?? "—") },
      ],
      chain: null,
      href: "/hiring",
    }),
    decide: (id, approve, note, userId) => candidates.decideOffer(id, approve, note, userId),
  },
  {
    module: "resignation",
    label: "Resignation",
    model: Resignation as never,
    pendingFilter: { status: "pending" },
    populate: [{ path: "employee", select: "name employeeCode" }],
    // Relieved is downstream of accepted; withdrawn is the employee changing
    // their mind, which nobody decided.
    decided: {
      filter: { status: { $in: ["accepted", "rejected", "relieved"] } },
      ...reviewedDecision(["accepted", "relieved"]),
    },
    toRow: (d) => ({
      id: String(d._id),
      title: `${name(d.employee)} resigning`,
      raisedBy: person(d.employee),
      raisedAt: (d.createdAt as Date) ?? null,
      summary: [
        { label: "Last working day", value: day(d.lastWorkingDay) },
        { label: "Reason", value: String(d.reason ?? "—") },
      ],
      chain: null,
      href: "/resignations",
    }),
    // The one review that takes no reviewer role — it has no chain to check.
    decide: (id, approve, note, userId) =>
      resignation.review(id, { status: approve ? "accepted" : "rejected", reviewNote: note } as never, userId),
  },
];

export const adapterFor = (module: string): Adapter | undefined =>
  ADAPTERS.find((a) => a.module === module);

const valueAt = (doc: Record<string, unknown>, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), doc);

/**
 * Whether one record has already been decided, by the same rule the list uses.
 *
 * Read off the adapter's own filter rather than restated, so a module can never
 * be listed as decided in one place and pending in the other.
 */
export function isDecided(module: string, doc: Record<string, never>): boolean {
  const a = adapterFor(module);
  if (!a) return false;
  return Object.entries(a.decided.filter).every(([path, condition]) => {
    const value = valueAt(doc, path);
    const anyOf = (condition as { $in?: string[] }).$in;
    return anyOf ? anyOf.includes(String(value)) : value === condition;
  });
}

/**
 * Where a record sits in its chain, from the snapshot on the record itself.
 *
 * Five of the seven carry these fields; the rest, and any row written before a
 * workflow was configured, have none and are single-step. Returning null for
 * those is the honest answer rather than inventing a step 1 of 1.
 */
export function chainOf(doc: Record<string, never>): ApprovalRow["chain"] {
  const steps = doc.approvalSteps as Array<{ order: number; roleName?: string; label?: string }> | undefined;
  const step = doc.workflowStep as number | undefined;
  if (!steps?.length || !step) return null;
  const current = steps.find((s) => s.order === step);
  return {
    step,
    total: (doc.workflowTotalSteps as number) ?? steps.length,
    waitingOn: current?.label || current?.roleName || "—",
  };
}
