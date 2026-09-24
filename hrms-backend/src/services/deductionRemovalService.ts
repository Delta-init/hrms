import { DeductionRemovalRequest } from "../models/DeductionRemovalRequest.js";
import { OneTimeAdjustment } from "../models/OneTimeAdjustment.js";
import { Loan } from "../models/Loan.js";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import type { CreateDeductionRemovalInput, ReviewDeductionRemovalInput } from "../validations/deductionRemovalValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { parsePagination } from "../utils/query.js";
import { isMonthEditable } from "./payrollBatchService.js";
import { computeLoanDeductions } from "./loanService.js";
import { computeOneTimeAdjustments } from "./oneTimeAdjustmentService.js";
import { sendMail } from "../utils/mailer.js";
import { notify } from "./notificationService.js";
import { watchersFor } from "./watchers.js";
import { env } from "../config/env.js";

class DeductionRemovalError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

const POP = [
  { path: "employee", select: "name employeeCode" },
  { path: "reviewedBy", select: "name email" },
];

interface Query extends PaginationQuery {
  status?: string;
}

async function mail(to: string, subject: string, heading: string, body: string) {
  try {
    await sendMail({
      to,
      organization: String(getOrgId() ?? ""),
      subject,
      text: `${heading}\n\n${body}\n\n${env.CLIENT_URL}/payroll\n`,
      html:
        `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">` +
        `<h2 style="color:#4f46e5;margin-bottom:4px">${heading}</h2><p style="color:#555">${body}</p>` +
        `<p><a href="${env.CLIENT_URL}/payroll" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open payroll</a></p>` +
        `<p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS.</p></div>`,
    });
  } catch {
    /* the request stands whether or not the mail got out */
  }
}

export class DeductionRemovalService {
  /**
   * What this employee could actually ask to have removed for `month` — their
   * own active loan's instalment for it, and any of their own one-time
   * deductions still outstanding by it. Nothing is offered for a month
   * already closed to editing, since a request against it could never do
   * anything.
   */
  async eligible(userId: string, month: string) {
    const employee = await Employee.findOne(scoped({ user: userId })).select("_id").lean();
    if (!employee) return { month, editable: false, items: [] as unknown[] };
    const editable = await isMonthEditable(month);
    if (!editable) return { month, editable: false, items: [] as unknown[] };

    const employeeId = String(employee._id);
    const [{ lines: loanLines, repayments }, oneTime, pending] = await Promise.all([
      computeLoanDeductions(employeeId, month),
      computeOneTimeAdjustments(employeeId, month),
      DeductionRemovalRequest.find(scoped({ employee: employeeId, month, status: "pending" }))
        .select("sourceType sourceId")
        .lean(),
    ]);
    const alreadyAsked = new Set(pending.map((p) => `${p.sourceType}:${String(p.sourceId)}`));

    const items = [
      ...loanLines.map((l, i) => ({
        sourceType: "loan" as const,
        sourceId: repayments[i]!.loanId,
        label: l.label,
        amount: l.amount,
        alreadyRequested: alreadyAsked.has(`loan:${repayments[i]!.loanId}`),
      })),
      ...oneTime.deductions.map((d) => ({
        sourceType: "adjustment" as const,
        sourceId: d.adjustmentId,
        label: d.label,
        amount: d.amount,
        alreadyRequested: alreadyAsked.has(`adjustment:${d.adjustmentId}`),
      })),
    ];
    return { month, editable: true, items };
  }

  async create(input: CreateDeductionRemovalInput, userId: string) {
    const employee = await Employee.findOne(scoped({ user: userId })).select("_id name").lean();
    if (!employee) throw new DeductionRemovalError("No employee record is linked to your login", 404);
    const employeeId = String(employee._id);

    if (!(await isMonthEditable(input.month))) {
      throw new DeductionRemovalError(
        `${input.month} is no longer open for changes — ask accounts to send it back if it needs a correction.`,
        409
      );
    }

    // Confirmed against a live figure rather than trusted from the form, and
    // snapshotted here — a loan balance moves every month, and a request
    // reviewed weeks later should still read as what was actually asked for.
    let sourceLabel: string;
    let amount: number;
    if (input.sourceType === "loan") {
      const { lines, repayments } = await computeLoanDeductions(employeeId, input.month);
      const i = repayments.findIndex((r) => r.loanId === input.sourceId);
      if (i < 0) throw new DeductionRemovalError("No instalment is due against that loan for this month", 404);
      sourceLabel = lines[i]!.label;
      amount = lines[i]!.amount;
    } else {
      const { deductions } = await computeOneTimeAdjustments(employeeId, input.month);
      const item = deductions.find((d) => d.adjustmentId === input.sourceId);
      if (!item) throw new DeductionRemovalError("That deduction is not outstanding for this month", 404);
      sourceLabel = item.label;
      amount = item.amount;
    }

    let record;
    try {
      record = await DeductionRemovalRequest.create({
        organization: getOrgId(),
        employee: employeeId,
        user: userId,
        month: input.month,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceLabel,
        amount,
        reason: input.reason,
        status: "pending",
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new DeductionRemovalError("You already have a pending request for this deduction and month", 409);
      }
      throw err;
    }

    const approvers = await watchersFor("deductionRemovals", userId);
    if (approvers.length) {
      await notify({
        users: approvers,
        kind: "approval",
        title: `Deduction removal requested — ${sourceLabel}`,
        body: `${employee.name} · ${input.month} · ${amount}`,
        href: "/payroll",
        actor: userId,
      });
      const people = await User.find({ _id: { $in: approvers }, status: { $ne: "inactive" } }).select("name email").lean();
      for (const p of people) {
        if (!p.email) continue;
        await mail(
          p.email,
          `Deduction removal requested — ${sourceLabel}`,
          "A deduction removal was requested",
          `<strong>${employee.name}</strong> asked that <strong>${sourceLabel}</strong> (${amount}) not be taken for ${input.month}.<br>${input.reason}`
        );
      }
    }

    return DeductionRemovalRequest.findById(record._id).populate(POP);
  }

  async listMine(userId: string, query: Query) {
    const { page, limit, skip } = parsePagination(query, 20, 200);
    const filter: Record<string, unknown> = { ...orgFilter(), user: userId };
    if (query.status) filter.status = query.status.includes(",") ? { $in: query.status.split(",") } : query.status;
    const [records, total] = await Promise.all([
      DeductionRemovalRequest.find(filter).populate(POP).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      DeductionRemovalRequest.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  /** The panel: everything, for whoever approves these. */
  async list(query: Query) {
    const { page, limit, skip } = parsePagination(query, 20, 200);
    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.status) filter.status = query.status.includes(",") ? { $in: query.status.split(",") } : query.status;
    const [records, total] = await Promise.all([
      DeductionRemovalRequest.find(filter).populate(POP).sort({ status: 1, createdAt: 1 }).skip(skip).limit(limit).lean(),
      DeductionRemovalRequest.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async review(id: string, input: ReviewDeductionRemovalInput, reviewerId: string) {
    const record = await DeductionRemovalRequest.findOne(scoped({ _id: id }));
    if (!record) throw new DeductionRemovalError("Request not found", 404);
    if (record.status !== "pending") throw new DeductionRemovalError("This request has already been decided", 400);

    // Re-checked at the moment of deciding, not only when it was raised — a
    // request can sit pending for weeks, and the month it names may have been
    // sent to accounts in the meantime.
    if (!(await isMonthEditable(record.month))) {
      throw new DeductionRemovalError(
        `${record.month} is no longer open for changes — this request can no longer take effect.`,
        409
      );
    }

    record.status = input.status;
    record.reviewedBy = reviewerId as never;
    record.reviewNote = input.reviewNote;
    record.reviewedAt = new Date();
    await record.save();

    // Forgiven outright rather than merely skipped this month — a one-time
    // deduction has no "next month" of its own to fall back into the way a
    // loan's instalment does, so approval closes it for good.
    if (input.status === "approved" && record.sourceType === "adjustment") {
      await OneTimeAdjustment.updateOne(
        { _id: record.sourceId },
        { $set: { waived: true, waivedAt: new Date(), waivedRequest: record._id } }
      );
    }

    try {
      await notify({
        users: [String(record.user)],
        kind: "payroll",
        tone: input.status === "approved" ? "positive" : "negative",
        title: `Deduction removal ${input.status} — ${record.sourceLabel}`,
        body: input.reviewNote ?? "",
        href: "/payroll",
        actor: reviewerId,
      });
    } catch {
      /* the mail below is the part that carries */
    }

    const requester = await User.findById(record.user).select("name email").lean<{ name?: string; email?: string } | null>();
    if (requester?.email) {
      await mail(
        requester.email,
        `Your deduction removal request was ${input.status}`,
        `Your request was ${input.status}`,
        `<strong>${record.sourceLabel}</strong> for ${record.month}${input.reviewNote ? `<br><br>${input.reviewNote}` : ""}` +
          (input.status === "approved"
            ? "<br><br>It will not be taken from that month's pay."
            : "")
      );
    }

    return DeductionRemovalRequest.findById(record._id).populate(POP);
  }

  /** The requester withdrawing their own, before anybody has decided it. */
  async cancelMine(id: string, userId: string) {
    const record = await DeductionRemovalRequest.findOne(scoped({ _id: id, user: userId }));
    if (!record) throw new DeductionRemovalError("Request not found", 404);
    if (record.status !== "pending") {
      throw new DeductionRemovalError("This has already been decided", 400);
    }
    await DeductionRemovalRequest.deleteOne({ _id: record._id });
    return { message: "Request withdrawn" };
  }
}
