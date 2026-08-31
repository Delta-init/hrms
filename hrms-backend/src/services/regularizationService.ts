import { Regularization } from "../models/Regularization.js";
import { getAttendancePenaltyPolicy } from "./attendancePenaltyService.js";
import { Attendance } from "../models/Attendance.js";
import { User } from "../models/User.js";
import type { CreateRegularizationInput, UpdateRegularizationInput, ReviewRegularizationInput } from "../validations/regularizationValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { zonedTimeToUtc } from "../utils/schedule.js";
import { beginWorkflowState, resolveReviewOutcome, assertNotSelfReview } from "./approvalWorkflowService.js";
import type { ReviewerRole } from "./approvalWorkflowService.js";
import { parsePagination } from "../utils/query.js";
import { notifyReviewed } from "./reviewNotifier.js";
import { reportingManagerUserId, managerContact } from "./reportingManager.js";
import { sendMail } from "../utils/mailer.js";
import { env } from "../config/env.js";

interface RegQuery extends PaginationQuery {
  user?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
}

const POP = [
  { path: "user", select: "name email designation" },
  { path: "reviewedBy", select: "name email" },
  // So an approver can see whose sign-off an escalated request is waiting on
  // without looking the manager up themselves.
  { path: "escalatedTo", select: "name email" },
];

// Wording for the notification email. The client has its own copy for the UI;
// an email is read outside the app and cannot borrow it.
const TYPE_LABELS: Record<string, string> = {
  missing_checkin: "Missing check-in",
  missing_checkout: "Missing check-out",
  wrong_time: "Wrong time",
  absent_correction: "Absent correction",
};
const STATUS_LABELS: Record<string, string> = {
  present: "Present", half_day: "Half day", wfh: "Work from home",
};

export class RegularizationService {
  /**
   * How many corrections this person has raised so far this month.
   *
   * Counted by when the request was *raised*, not the day it corrects: somebody
   * fixing three days of last month in one sitting has still asked three times
   * this month, and it is the asking that the allowance is about.
   *
   * Rejected and cancelled requests do not count. An allowance spent on a
   * request nobody granted would punish people for asking, which is the
   * opposite of what this is for.
   */
  private async raisedThisMonth(userId: unknown, now = new Date()): Promise<number> {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return Regularization.countDocuments(
      scoped({ user: userId, createdAt: { $gte: from, $lt: to }, status: { $nin: ["rejected", "cancelled"] } })
    );
  }

  /** What the requester should be told before they submit. */
  async monthlyAllowance(userId: string) {
    const policy = await getAttendancePenaltyPolicy();
    const used = await this.raisedThisMonth(userId);
    const limit = policy.monthlyRegularizationLimit;
    return {
      used,
      limit,
      remaining: Math.max(0, limit - used),
      /** True when the *next* request would need the manager. */
      nextNeedsManager: used >= limit,
      managerId: used >= limit ? await reportingManagerUserId(userId) : null,
    };
  }

  async create(input: CreateRegularizationInput) {
    const user = await User.findById(input.user);
    if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });
    const workflow = await beginWorkflowState("regularization");
    // The form sends a choice; a request raised without one takes the
    // organization's default rather than a value fixed in the code.
    const policy = await getAttendancePenaltyPolicy();

    const already = await this.raisedThisMonth(input.user);
    const monthlyIndex = already + 1;
    const overLimit = monthlyIndex > policy.monthlyRegularizationLimit;
    // Only looked up when it matters — most requests are within the allowance
    // and should not pay for two extra queries.
    const escalatedTo = overLimit ? await reportingManagerUserId(input.user) : null;

    const reg = await Regularization.create({
      ...input,
      resultingStatus: input.resultingStatus ?? policy.defaultRegularizationStatus ?? "present",
      organization: getOrgId(),
      status: input.status ?? "pending",
      monthlyIndex,
      escalated: overLimit,
      escalatedTo,
      ...workflow,
    });

    if (overLimit) await this.notifyManagerOfEscalation(reg, user, monthlyIndex, policy.monthlyRegularizationLimit);
    return Regularization.findById(reg._id).populate(POP);
  }

  /**
   * Tell the manager a correction needs them.
   *
   * Best-effort and deliberately after the record is saved: a mail server
   * having a bad afternoon must not lose somebody's request.
   */
  private async notifyManagerOfEscalation(
    reg: { _id: unknown; date: Date; timeZone?: string; type: string; reason?: string; escalatedTo?: unknown },
    requester: { name?: string },
    index: number,
    limit: number
  ) {
    try {
      if (!reg.escalatedTo) return;
      const manager = await managerContact(String(reg.escalatedTo));
      if (!manager?.email) return;

      const tz = reg.timeZone || "Asia/Dubai";
      const day = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: tz }).format(reg.date);
      const who = requester.name ?? "Somebody in your team";
      const link = `${env.CLIENT_URL}/regularization`;

      await sendMail({
        to: manager.email,
        subject: `${who} has asked for a ${index}${index === 2 ? "nd" : index === 3 ? "rd" : "th"} attendance correction this month`,
        text:
          `${who} has raised ${index} attendance corrections this month; the allowance is ${limit}.\n\n` +
          `Date: ${day}\nCorrection: ${TYPE_LABELS[reg.type] ?? reg.type}\n` +
          (reg.reason ? `Reason: ${reg.reason}\n` : "") +
          `\nThis one needs your approval: ${link}`,
        html:
          `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">` +
          `<h2 style="color:#4f46e5;margin-bottom:4px">An attendance correction needs you</h2>` +
          `<p style="color:#555"><strong>${who}</strong> has raised <strong>${index}</strong> corrections this month. ` +
          `The allowance is ${limit}, so this one comes to you rather than going through on its own.</p>` +
          `<table style="border-collapse:collapse;margin:16px 0;font-size:14px">` +
          `<tr><td style="padding:4px 12px 4px 0;color:#888">Date</td><td style="padding:4px 0;font-weight:600">${day}</td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0;color:#888">Correction</td><td style="padding:4px 0;font-weight:600">${TYPE_LABELS[reg.type] ?? reg.type}</td></tr>` +
          (reg.reason ? `<tr><td style="padding:4px 12px 4px 0;color:#888">Reason</td><td style="padding:4px 0">${reg.reason}</td></tr>` : "") +
          `</table>` +
          `<p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Review it</a></p>` +
          `</div>`,
      });
    } catch {
      /* the request is saved; a failed notice is not worth failing the write */
    }
  }

  async list(query: RegQuery) {
    const { page, limit, skip } = parsePagination(query, 50, 200);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.user) filter.user = query.user;
    if (query.status) filter.status = query.status;
    if (query.type) filter.type = query.type;
    if (query.dateFrom || query.dateTo) {
      const range: Record<string, Date> = {};
      if (query.dateFrom) range.$gte = new Date(`${query.dateFrom}T00:00:00.000Z`);
      // `$lt` the following day, so a bare end date covers the whole day
      // rather than only its first instant.
      if (query.dateTo) range.$lt = new Date(new Date(`${query.dateTo}T00:00:00.000Z`).getTime() + 86_400_000);
      filter.date = range;
    }

    const sortable = new Set(["createdAt", "date", "status", "type"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "createdAt";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      Regularization.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit).lean(),
      Regularization.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async listMine(userId: string, query: RegQuery) {
    return this.list({ ...query, user: userId });
  }

  async getById(id: string) {
    const record = await Regularization.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Regularization not found"), { statusCode: 404 });
    return record;
  }

  /** On approval, apply the corrected times to the Attendance record for user+date. */
  private async applyToAttendance(reg: { user: unknown; date: Date; timeZone: string; resultingStatus?: string; requestedCheckIn?: Date | null; requestedCheckOut?: Date | null }) {
    // Normalize to the local-midnight-UTC convention self-service uses, and match
    // the whole day, so we update the existing record instead of creating a
    // duplicate. Stamp the org so the row is never invisible to scoped reports.
    const dayStr = new Date(reg.date).toISOString().slice(0, 10);
    const dayStart = zonedTimeToUtc(dayStr, "00:00", reg.timeZone);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    let att = await Attendance.findOne(scoped({ user: reg.user, date: { $gte: dayStart, $lt: dayEnd } }));
    if (!att) {
      att = new Attendance({ organization: getOrgId(), user: reg.user, date: dayStart, timeZone: reg.timeZone, status: reg.resultingStatus ?? "present" });
    }
    att.timeZone = reg.timeZone;
    if (reg.requestedCheckIn) {
      att.sessions = [{ checkIn: reg.requestedCheckIn, checkOut: reg.requestedCheckOut ?? null }] as never;
    } else if (reg.requestedCheckOut && att.sessions.length > 0) {
      att.sessions[att.sessions.length - 1].checkOut = reg.requestedCheckOut;
    }
    // The approved outcome wins outright. Flipping only absent left a corrected
    // day still marked late or half-day, which then priced it as lost pay.
    att.status = (reg.resultingStatus ?? "present") as never;
    await att.save();
  }

  /** Edit a request's details. Cannot change status — see review(). */
  async update(id: string, input: UpdateRegularizationInput) {
    const record = await Regularization.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Regularization not found"), { statusCode: 404 });
    // An approved request has already written times and a status into the
    // Attendance record. Editing it here would leave the two disagreeing
    // without touching the day itself, so the correction has to start again.
    if (record.status !== "pending") {
      throw Object.assign(
        new Error(`This request has already been ${record.status} and can no longer be edited`),
        { statusCode: 400 }
      );
    }

    if (input.date !== undefined) record.date = input.date;
    if (input.timeZone !== undefined) record.timeZone = input.timeZone;
    if (input.type !== undefined) record.type = input.type;
    if (input.resultingStatus !== undefined) record.resultingStatus = input.resultingStatus;
    if (input.requestedCheckIn !== undefined) record.requestedCheckIn = input.requestedCheckIn;
    if (input.requestedCheckOut !== undefined) record.requestedCheckOut = input.requestedCheckOut;
    if (input.reason !== undefined) record.reason = input.reason ?? undefined;

    await record.save();
    return Regularization.findById(id).populate(POP);
  }

  /**
   * Approve or reject a request. Split out of update() so it can be gated on
   * the `approve` permission — approving writes corrected punch times straight
   * into the Attendance record, which `edit` alone should not authorise.
   */
  async review(id: string, input: ReviewRegularizationInput, reviewerId: string, reviewerRole: ReviewerRole) {
    const record = await Regularization.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Regularization not found"), { statusCode: 404 });
    if (record.status !== "pending") {
      throw Object.assign(new Error("This request has already been reviewed"), { statusCode: 400 });
    }
    assertNotSelfReview(record.user, reviewerId);

    /**
     * A request past the month's allowance belongs to the person's manager.
     *
     * Checked before anything else is written, and not softened for whoever
     * happens to hold the regularization permission — the whole point of the
     * allowance is that the fourth correction is seen by somebody who knows
     * whether it is reasonable, and HR waving it through would make the rule
     * decorative.
     *
     * A Super Admin is still allowed through, as everywhere else in the
     * approval engine, and so is the case where no manager could be identified
     * — refusing there would strand the request with nobody able to act.
     */
    if (record.escalated && record.escalatedTo) {
      const isSuperAdmin = reviewerRole.isSystemRole && reviewerRole.roleName === "Super Admin";
      if (!isSuperAdmin && String(record.escalatedTo) !== String(reviewerId)) {
        const manager = await managerContact(String(record.escalatedTo));
        throw Object.assign(
          new Error(
            `This is correction ${record.monthlyIndex} of the month, past the allowance, so it needs ` +
            `${manager?.name ? `${manager.name} — the requester's reporting manager` : "the requester's reporting manager"}.`
          ),
          { statusCode: 403 }
        );
      }
    }

    if (input.reviewNote !== undefined) record.reviewNote = input.reviewNote ?? undefined;
    // The approver may correct the day's outcome as they approve. Recorded on
    // the request itself so the trail shows what was actually applied, not
    // what was originally asked for.
    if (input.resultingStatus !== undefined) record.resultingStatus = input.resultingStatus;

    const outcome = resolveReviewOutcome(
      record.approvalSteps, record.workflowStep, input.status, input.reviewNote, reviewerRole
    );
    record.approvalTrail = [...(record.approvalTrail ?? []), outcome.trailEntry];
    if (outcome.advance) {
      record.workflowStep = (record.workflowStep ?? 1) + 1;
    } else {
      if (input.status === "approved" && !record.requestedCheckIn && !record.requestedCheckOut) {
        throw Object.assign(
          new Error("This request has no corrected check-in or check-out time to apply"),
          { statusCode: 400 }
        );
      }
      record.status = input.status;
      record.reviewedBy = reviewerId as never;
      record.reviewedAt = new Date();
      if (input.status === "approved") await this.applyToAttendance(record);
    }

    await record.save();

    // Only once the decision is final — an intermediate approval step is not an
    // outcome, and telling somebody twice about one request is worse than late.
    if (!outcome.advance) {
      const tz = record.timeZone || "Asia/Dubai";
      const day = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: tz }).format(record.date);
      const time = (d?: Date | null) =>
        d ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d) : "—";
      const details = [
        { label: "Date", value: day },
        { label: "Correction", value: TYPE_LABELS[record.type] ?? record.type },
      ];
      if (record.status === "approved") {
        details.push({ label: "Marked as", value: STATUS_LABELS[record.resultingStatus ?? "present"] ?? "Present" });
        details.push({ label: "Times applied", value: `${time(record.requestedCheckIn)} – ${time(record.requestedCheckOut)}` });
      }
      await notifyReviewed({
        userId: record.user,
        subject: "Regularization request",
        approved: record.status === "approved",
        details,
        note: record.reviewNote,
        path: "/regularization",
      });
    }

    return Regularization.findById(id).populate(POP);
  }

  async remove(id: string) {
    const record = await Regularization.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Regularization not found"), { statusCode: 404 });
    return { message: "Regularization deleted successfully" };
  }
}
