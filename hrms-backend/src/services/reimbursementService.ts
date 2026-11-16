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
import { Types } from "mongoose";
import { User } from "../models/User.js";
import { notify } from "./notificationService.js";
import { sendMail } from "../utils/mailer.js";
import { env } from "../config/env.js";

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

/**
 * Finance decides the claims HR approves (the user, 2026-11-16: "employee request => HR approval => finance approval
 * (paid status)"): HR's last approval leaves a claim `hr_approved`, finance pays it from the finance system — it is
 * then "paid", with finance's expense number, and never goes into a payslip — or refuses it. Off unless exactly "on":
 * HR's approval stays final and the payslip pays the claim, as before.
 */
export const reimbursementFinanceStepOn = () => env.REIMBURSEMENT_FINANCE_STEP === "on";

/** Which claims finance asks for: its queue (hr_approved, the default), or its record — paid or refused by it, or all
 *  that reached it. */
export const FINANCE_REIMBURSEMENT_STATUSES = ["hr_approved", "paid", "rejected", "all"] as const;
export type FinanceReimbursementStatus = (typeof FINANCE_REIMBURSEMENT_STATUSES)[number];

const STATUS_WORDS: Record<string, string> = {
  pending: "still with HR", approved: "approved for the payslip", rejected: "refused", paid: "paid",
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number, c: string) => `${c} ${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ymd = (d: unknown) => (d ? new Date(d as string).toISOString().slice(0, 10) : null);

class ClaimError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) { super(message); this.statusCode = statusCode; }
}

/** One claim as finance reads it — the integration contract. */
function forFinance(r: Record<string, unknown>) {
  const emp = (r.employee ?? null) as { _id?: unknown; name?: string; employeeCode?: string; designation?: string; currency?: string; department?: { _id?: unknown; name?: string } | null } | null;
  const who = (r.user ?? null) as { name?: string; email?: string } | null;
  const hr = (r.reviewedBy ?? null) as { name?: string } | null;
  return {
    _id: String(r._id),
    title: String(r.title ?? ""),
    category: String(r.category ?? "other"),
    amount: r2(Number(r.amount ?? 0)),
    // What was claimed, when finance paid a different amount (2026-11-16) — null when paid as claimed. Always sent:
    // it also tells finance this HRMS takes a changed amount.
    requestedAmount: r.requestedAmount == null ? null : r2(Number(r.requestedAmount)),
    // A claim has no currency of its own: it is the employee's pay currency.
    currency: String(emp?.currency || "AED").toUpperCase(),
    expenseDate: ymd(r.expenseDate),
    month: String(r.month ?? ""),
    description: String(r.description ?? ""),
    receiptUrl: String(r.receiptUrl ?? ""),
    status: String(r.status),
    employee: emp ? {
      _id: String(emp._id ?? ""), name: emp.name ?? "", employeeCode: emp.employeeCode ?? "", designation: emp.designation ?? "",
      department: emp.department && typeof emp.department === "object" ? { _id: String(emp.department._id ?? ""), name: emp.department.name ?? "" } : null,
    } : null,
    user: who ? { name: who.name ?? "", email: who.email ?? "" } : null,
    hrReviewedBy: hr ? { name: hr.name ?? "" } : null,
    hrReviewedAt: r.reviewedAt ?? null,
    hrNote: String(r.reviewNote ?? ""),
    createdAt: r.createdAt ?? null,
    rejectedBy: (r.rejectedBy as string | null) ?? null,
    financeRef: String(r.financeRef ?? ""),
    paidOn: ymd(r.paidOn),
    paymentMethod: String(r.paymentMethod ?? ""),
    financeNote: String(r.financeNote ?? ""),
    financeReviewedBy: String(r.financeReviewedBy ?? ""),
    financeReviewedAt: r.financeReviewedAt ?? null,
  };
}

const FINANCE_POP = [
  { path: "employee", select: "name employeeCode designation currency department", populate: { path: "department", select: "name" } },
  { path: "user", select: "name email" },
  { path: "reviewedBy", select: "name" },
];

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
    // Past HR: finance pays it or refuses it, in the finance system.
    if (record.status === "hr_approved")
      throw Object.assign(new Error("This claim is with finance now — finance pays it or refuses it"), { statusCode: 409 });
    if (record.rejectedBy === "finance")
      throw Object.assign(new Error("Finance refused this claim — it can't be decided again here; file a new claim"), { statusCode: 409 });
    if (input.reviewNote !== undefined) record.reviewNote = input.reviewNote ?? undefined;

    const outcome = resolveReviewOutcome(
      record.approvalSteps, record.workflowStep, input.status, input.reviewNote, reviewerRole
    );
    record.approvalTrail = [...(record.approvalTrail ?? []), outcome.trailEntry];
    if (outcome.advance) {
      record.workflowStep = (record.workflowStep ?? 1) + 1;
    } else {
      // HR's last word. With the finance step on, an approval passes it to finance, which pays it — never the
      // payslip. One already approved for the payslip (before the step) stays on that road.
      const toFinance = input.status === "approved" && reimbursementFinanceStepOn() && record.status !== "approved";
      record.status = toFinance ? "hr_approved" : input.status;
      record.rejectedBy = input.status === "rejected" ? "hr" : null;
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
    // Finance may be paying it this minute; it refuses it if it shouldn't be paid.
    if (record.status === "hr_approved")
      throw Object.assign(new Error("This claim is with finance — it can't be deleted while finance has it"), { statusCode: 409 });
    await Reimbursement.deleteOne({ _id: record._id });
    return { message: "Reimbursement deleted successfully" };
  }

  // ── Finance integration ────────────────────────────────────────────────────
  // Finance never logs in here: its half arrives over the integration API, the organization named outright because a
  // machine request has no user to take it from — the same way salary advances and procurement work.

  /**
   * Claims for finance. By default its queue — HR approved, finance not yet decided — oldest HR approval first. With
   * a status, its record, newest first, the latest 500: "paid" paid by finance, "rejected" refused by finance, "all"
   * every claim that reached finance.
   */
  async listForFinance(organization: string, status: FinanceReimbursementStatus = "hr_approved") {
    if (!Types.ObjectId.isValid(organization)) return [];
    const org = new Types.ObjectId(organization);
    const decided = { financeReviewedAt: { $ne: null } };
    const filter =
      status === "hr_approved" ? { organization: org, status: "hr_approved" }
      : status === "paid" ? { organization: org, status: "paid", ...decided }
      : status === "rejected" ? { organization: org, status: "rejected", rejectedBy: "finance" }
      : { organization: org, $or: [{ status: "hr_approved" }, decided] };
    const rows = await Reimbursement.find(filter)
      .populate(FINANCE_POP)
      .sort(status === "hr_approved" ? { reviewedAt: 1, createdAt: 1 } : { financeReviewedAt: -1, reviewedAt: -1 })
      .limit(status === "hr_approved" ? 0 : 500)
      .lean();
    return rows.map((r) => forFinance(r as unknown as Record<string, unknown>));
  }

  /**
   * Finance's decision. Paying it makes the claim "paid", with finance's expense number, date and method; refusing it
   * "rejected" by finance, with its reason. A repeat of the decision finance already made — a retry after a lost
   * answer — answers with the claim rather than refusing, so finance can safely send again. Anything else not waiting
   * on finance is a 409.
   *
   * Finance may pay a different amount than was claimed (the user, 2026-11-16: "finance can edit the amount… it will
   * show in HRMS also"): `amount` becomes what was paid and the claimed one is kept as `requestedAmount`. More than
   * was claimed needs a note saying why.
   */
  async recordFinanceDecision(
    organization: string,
    id: string,
    input: { decision: "approve" | "reject"; note?: string | null; reference?: string | null; paidOn?: string | null; method?: string | null; by?: string | null; amount?: number | string | null }
  ) {
    if (!Types.ObjectId.isValid(organization) || !Types.ObjectId.isValid(id)) throw new ClaimError("Claim not found", 404);
    const record = await Reimbursement.findOne({ _id: id, organization });
    if (!record) throw new ClaimError("Claim not found", 404);
    const approve = input.decision === "approve";
    const repeat = !!record.financeReviewedAt
      && ((approve && record.status === "paid") || (!approve && record.status === "rejected" && record.rejectedBy === "finance"));
    if (!repeat) {
      if (record.status !== "hr_approved") {
        throw new ClaimError(`Only a claim HR has approved is waiting on finance — this one is ${STATUS_WORDS[record.status] ?? record.status}`, 409);
      }
      // The employee is told why.
      if (!approve && String(input.note ?? "").trim().length < 3) throw new ClaimError("Say why finance refuses this claim", 400);
      if (approve) {
        if (input.amount != null && input.amount !== "") {
          const paid = r2(Number(input.amount));
          if (!Number.isFinite(paid) || paid <= 0) throw new ClaimError("The amount paid must be more than 0", 400);
          if (paid !== r2(record.amount)) {
            if (paid > record.amount && !String(input.note ?? "").trim()) {
              throw new ClaimError(`Paying more than the ${r2(record.amount).toFixed(2)} claimed needs a note saying why`, 400);
            }
            record.requestedAmount = record.requestedAmount ?? record.amount;
            record.amount = paid;
          }
        }
        const paidOn = input.paidOn && /^\d{4}-\d{2}-\d{2}$/.test(input.paidOn) ? input.paidOn : new Date().toISOString().slice(0, 10);
        record.status = "paid";
        record.financeRef = String(input.reference ?? "").trim().slice(0, 120);
        record.paidOn = new Date(`${paidOn}T00:00:00.000Z`);
        record.paymentMethod = String(input.method ?? "").trim().slice(0, 40);
      } else {
        record.status = "rejected";
        record.rejectedBy = "finance";
      }
      record.financeReviewedAt = new Date();
      record.financeNote = String(input.note ?? "").trim().slice(0, 500);
      record.financeReviewedBy = String(input.by ?? "").trim().slice(0, 120);
      await record.save();
      // Finance is waiting on this answer; the notice can follow it.
      announceFinanceDecision(record._id, organization).catch((err) =>
        console.error(`reimbursements: could not announce finance's decision on ${record._id}:`, err instanceof Error ? err.message : err)
      );
    }
    const r = await Reimbursement.findById(record._id).populate(FINANCE_POP).lean();
    return forFinance(r as unknown as Record<string, unknown>);
  }
}

/** Tell the employee what finance did, in-app and by mail. Never throws. */
async function announceFinanceDecision(id: unknown, organization: string) {
  const r = await Reimbursement.findById(id).populate([{ path: "employee", select: "currency" }]).lean<Record<string, unknown> | null>();
  if (!r?.user) return;
  const currency = String((r.employee as { currency?: string } | null)?.currency || "AED").toUpperCase();
  const what = `${String(r.title ?? "Your claim")} — ${money(Number(r.amount ?? 0), currency)}`
    // Paid at another amount than claimed: say so.
    + (r.status === "paid" && r.requestedAmount != null ? `, instead of the ${money(Number(r.requestedAmount), currency)} you claimed` : "");
  const paid = r.status === "paid";
  const title = paid ? "Your reimbursement has been paid" : "Your reimbursement was not approved by finance";
  const paidLine = paid
    ? `Paid on ${new Date(r.paidOn as Date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`
      + `${r.paymentMethod ? ` by ${String(r.paymentMethod).replace(/_/g, " ")}` : ""}${r.financeRef ? ` (${String(r.financeRef)})` : ""}.`
    : "";
  const note = r.financeNote ? String(r.financeNote) : "";
  const body = [what + ".", paidLine, note ? `Finance: ${note}` : ""].filter(Boolean).join(" ");
  try {
    await notify({ users: [String(r.user)], kind: "payroll", tone: paid ? "positive" : "negative", title, body, href: "/reimbursements", organization });
  } catch { /* the mail below */ }
  try {
    const who = await User.findById(r.user).select("email").lean<{ email?: string } | null>();
    if (!who?.email) return;
    const link = `${env.CLIENT_URL}/reimbursements`;
    await sendMail({
      to: who.email,
      organization,
      subject: title,
      text: `${title}\n\n${body}\n\n${link}\n`,
      html:
        `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">` +
        `<h2 style="color:#4f46e5;margin-bottom:4px">${esc(title)}</h2><p style="color:#555">${esc(what)}.${paidLine ? `<br>${esc(paidLine)}` : ""}${note ? `<br><br>${esc(note)}` : ""}</p>` +
        `<p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open reimbursements</a></p>` +
        `<p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS.</p></div>`,
    });
  } catch { /* the decision stands whether or not the mail got out */ }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

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
