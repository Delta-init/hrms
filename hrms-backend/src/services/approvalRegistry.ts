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
}

interface Adapter {
  module: ApprovalModule;
  label: string;
  model: Model<never>;
  /** What "still waiting" means for this module. */
  pendingFilter: Record<string, unknown>;
  populate: Array<Record<string, unknown>>;
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
const idOf = (v: unknown): string | null =>
  v && typeof v === "object" ? String((v as { _id?: unknown })._id ?? "") : v ? String(v) : null;
const day = (d: unknown): string =>
  d ? new Date(d as string).toISOString().slice(0, 10) : "—";
const person = (v: unknown) => (v ? { id: idOf(v), name: name(v) } : null);

const decision = (approve: boolean) => (approve ? "approved" : "rejected") as "approved" | "rejected";

export const ADAPTERS: Adapter[] = [
  {
    module: "leave",
    label: "Leave",
    model: LeaveRequest as never,
    pendingFilter: { status: "pending" },
    populate: [{ path: "user", select: "name email" }],
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
    toRow: (d) => ({
      id: String(d._id),
      title: `${String(d.title ?? "Claim")} — ${d.currency ?? ""} ${d.amount ?? 0}`.trim(),
      raisedBy: person(d.user),
      raisedAt: (d.createdAt as Date) ?? null,
      summary: [
        { label: "Amount", value: `${d.currency ?? ""} ${d.amount ?? 0}`.trim() },
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
    toRow: (d) => ({
      id: String(d._id),
      title: `Confirm ${name(d.employee)}`,
      raisedBy: person(d.employee),
      raisedAt: (d.createdAt as Date) ?? null,
      summary: [
        { label: "Due", value: day(d.dueDate) },
        { label: "Recommendation", value: String(d.recommendation ?? "—").replace(/_/g, " ") },
      ],
      chain: null,
      href: "/confirmations",
    }),
    decide: (id, approve, note, userId, role) =>
      confirmation.review(id, { status: decision(approve), reviewNote: note } as never, userId, role),
  },
  {
    module: "hiring",
    label: "Hiring requisition",
    model: JobRequisition as never,
    pendingFilter: { status: "pending" },
    populate: [{ path: "raisedBy", select: "name email" }, { path: "department", select: "name" }],
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
    ],
    toRow: (d) => ({
      id: String(d._id),
      title: `Offer to ${name(d.candidate)}`,
      raisedBy: person((d.offerApproval as { requestedBy?: unknown } | undefined)?.requestedBy),
      raisedAt: ((d.offerApproval as { requestedAt?: Date } | undefined)?.requestedAt) ?? null,
      summary: [
        { label: "Role", value: name(d.requisition) },
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
