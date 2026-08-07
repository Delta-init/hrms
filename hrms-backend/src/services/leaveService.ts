import { LeaveRequest } from "../models/LeaveRequest.js";
import { User } from "../models/User.js";
import { Holiday } from "../models/Holiday.js";
import type { CreateLeaveInput, UpdateLeaveInput, ReviewLeaveInput } from "../validations/leaveValidation.js";
import type { PaginationQuery, LeaveType } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { compOffBalanceFor } from "./compOffService.js";
import { beginWorkflowState, resolveReviewOutcome, assertNotSelfReview } from "./approvalWorkflowService.js";
import type { ReviewerRole } from "./approvalWorkflowService.js";
import { parsePagination } from "../utils/query.js";

interface LeaveQuery extends PaginationQuery {
  user?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
}

const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri (0=Sun)
const workDaysOf = (user: { workSchedule?: { workDays?: number[] } | unknown } | null): number[] =>
  (user?.workSchedule as { workDays?: number[] } | undefined)?.workDays ?? DEFAULT_WORK_DAYS;

/** A half-day leave must fall on a single date. */
function assertHalfDayIsSingleDay(halfDay: boolean, start: Date, end: Date) {
  if (halfDay && new Date(start).setHours(0, 0, 0, 0) !== new Date(end).setHours(0, 0, 0, 0)) {
    throw Object.assign(new Error("A half-day leave must be a single date"), { statusCode: 400 });
  }
}

/**
 * Refuse leave the requester's schedule doesn't grant.
 *
 * The schedule lists which types exist and how many days a month each allows,
 * so a type missing from it cannot be taken at all — previously every type in
 * the enum was offered to everyone and nothing checked the amount, so a month's
 * allowance could be exceeded without anything noticing.
 *
 * `excludeId` lets an edit ignore the request being edited when totalling the
 * month, or amending one by a day would count it twice.
 */
async function assertLeaveAllowed(
  user: { workSchedule?: unknown },
  type: LeaveType,
  startDate: Date,
  days: number,
  excludeId: string | null
) {
  const schedule = user.workSchedule as
    | { name?: string; leavePolicies?: Array<{ type: string; label?: string; monthlyDays: number }> }
    | null
    | undefined;

  // No schedule, or one that predates leave policies: nothing to check against,
  // so behave as before rather than blocking everyone on an empty list.
  const policies = schedule?.leavePolicies;
  if (!schedule || !policies?.length) return;

  const policy = policies.find((p) => p.type === type);
  if (!policy) {
    // A custom type has no built-in name, so fall back to the slug itself.
    const named = LEAVE_TYPE_LABEL[type] ?? type;
    throw Object.assign(
      new Error(`${named} isn't available on ${schedule.name || "this work schedule"}`),
      { statusCode: 400 }
    );
  }
  const policyName = policy.label?.trim() || LEAVE_TYPE_LABEL[type] || type;

  // Allowance is per calendar month, counted against the month the leave starts in.
  const monthStart = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 1));
  const filter: Record<string, unknown> = {
    user: (user as { _id: unknown })._id,
    type,
    status: { $in: ["pending", "approved"] },
    startDate: { $gte: monthStart, $lt: monthEnd },
  };
  if (excludeId) filter._id = { $ne: excludeId };

  const taken = (await LeaveRequest.find(scoped(filter)).select("days").lean())
    .reduce((a, r) => a + (r.days || 0), 0);
  const remaining = Math.round((policy.monthlyDays - taken) * 100) / 100;

  if (days > remaining) {
    throw Object.assign(
      new Error(
        `Only ${remaining} day${remaining === 1 ? "" : "s"} of ${policyName} left this month (${policy.monthlyDays}/month, ${taken} already booked)`
      ),
      { statusCode: 400 }
    );
  }
}

const LEAVE_TYPE_LABEL: Record<string, string> = {
  annual: "Annual leave", sick: "Sick leave", casual: "Casual leave", unpaid: "Unpaid leave",
  maternity: "Maternity leave", paternity: "Paternity leave", wfh: "Work from home", comp_off: "Comp-off",
};

export class LeaveService {
  /** Working days in [start,end], excluding non-work-days (weekends) and org holidays. */
  private async countWorkingDays(start: Date, end: Date, workDays: number[]): Promise<number> {
    const su = new Date(Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth(), new Date(start).getUTCDate()));
    const eu = new Date(Date.UTC(new Date(end).getUTCFullYear(), new Date(end).getUTCMonth(), new Date(end).getUTCDate()));
    const holidays = await Holiday.find(scoped({ date: { $gte: su, $lte: eu } })).select("date").lean();
    const holSet = new Set(holidays.map((h) => new Date(h.date).toISOString().slice(0, 10)));
    let count = 0;
    const cur = new Date(su);
    while (cur <= eu) {
      if (workDays.includes(cur.getUTCDay()) && !holSet.has(cur.toISOString().slice(0, 10))) count++;
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return count;
  }

  async create(input: CreateLeaveInput) {
    // Scope the user to the caller's org so a request can't reference another tenant's user.
    const user = await User.findOne(scoped({ _id: input.user })).populate("workSchedule", "workDays leavePolicies name");
    if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });

    if (input.endDate < input.startDate) {
      throw Object.assign(new Error("End date cannot be before start date"), { statusCode: 400 });
    }
    assertHalfDayIsSingleDay(input.halfDay, input.startDate, input.endDate);

    // Reject overlaps with an existing pending/approved request for the same user.
    const clash = await LeaveRequest.findOne({
      user: input.user,
      status: { $in: ["pending", "approved"] },
      startDate: { $lte: input.endDate },
      endDate: { $gte: input.startDate },
    }).select("_id");
    if (clash) {
      throw Object.assign(
        new Error("This overlaps an existing leave request for these dates"),
        { statusCode: 409 }
      );
    }

    const days = input.halfDay ? 0.5 : await this.countWorkingDays(input.startDate, input.endDate, workDaysOf(user));

    await assertLeaveAllowed(user, input.type, input.startDate, days, null);

    if (input.type === "comp_off") {
      const balance = await compOffBalanceFor(input.user);
      if (days > balance) {
        throw Object.assign(
          new Error(`Insufficient comp-off balance (${balance} day${balance === 1 ? "" : "s"} available, ${days} requested)`),
          { statusCode: 400 }
        );
      }
    }

    const workflow = await beginWorkflowState("leave");
    const leave = await LeaveRequest.create({
      organization: getOrgId(),
      user: input.user,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      halfDay: input.halfDay,
      days,
      timeZone: input.timeZone,
      reason: input.reason,
      status: input.status ?? "pending",
      ...workflow,
    });
    return LeaveRequest.findById(leave._id).populate("user", "name email designation");
  }

  async list(query: LeaveQuery) {
    const { page, limit, skip } = parsePagination(query, 50, 200);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.user) filter.user = query.user;
    if (query.status) filter.status = query.status;
    if (query.type) filter.type = query.type;
    // Date-range overlap: leave overlaps [from,to] if endDate >= from AND startDate <= to.
    if (query.dateFrom) filter.endDate = { $gte: new Date(query.dateFrom) };
    if (query.dateTo) filter.startDate = { $lte: new Date(query.dateTo) };

    const sortable = new Set(["createdAt", "startDate", "endDate", "days", "status", "type"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "createdAt";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      LeaveRequest.find(filter)
        .populate("user", "name email designation")
        .populate("reviewedBy", "name email")
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(limit)
        .lean(),
      LeaveRequest.countDocuments(filter),
    ]);

    return { records, pagination: buildPagination(total, page, limit) };
  }

  /** Current user's own leave requests (self-service). */
  async listMine(userId: string, query: LeaveQuery) {
    return this.list({ ...query, user: userId });
  }

  async getById(id: string) {
    const record = await LeaveRequest.findOne(scoped({ _id: id }))
      .populate("user", "name email designation")
      .populate("reviewedBy", "name email");
    if (!record) throw Object.assign(new Error("Leave request not found"), { statusCode: 404 });
    return record;
  }

  /** Edit a request's details. Cannot change status — see review(). */
  async update(id: string, input: UpdateLeaveInput) {
    const record = await LeaveRequest.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Leave request not found"), { statusCode: 404 });

    if (input.type !== undefined) record.type = input.type;
    if (input.startDate !== undefined) record.startDate = input.startDate;
    if (input.endDate !== undefined) record.endDate = input.endDate;
    if (input.halfDay !== undefined) record.halfDay = input.halfDay;
    if (input.timeZone !== undefined) record.timeZone = input.timeZone;
    if (input.reason !== undefined) record.reason = input.reason ?? undefined;

    if (record.endDate < record.startDate) {
      throw Object.assign(new Error("End date cannot be before start date"), { statusCode: 400 });
    }
    assertHalfDayIsSingleDay(record.halfDay, record.startDate, record.endDate);

    // Re-check overlap when the dates changed (create guards this; update must too).
    if (input.startDate !== undefined || input.endDate !== undefined) {
      const clash = await LeaveRequest.findOne(scoped({
        _id: { $ne: record._id },
        user: record.user,
        status: { $in: ["pending", "approved"] },
        startDate: { $lte: record.endDate },
        endDate: { $gte: record.startDate },
      })).select("_id");
      if (clash) throw Object.assign(new Error("This overlaps an existing leave request for these dates"), { statusCode: 409 });
    }
    const subject = await User.findById(record.user).populate("workSchedule", "workDays");
    record.days = record.halfDay ? 0.5 : await this.countWorkingDays(record.startDate, record.endDate, workDaysOf(subject));

    const owner = await User.findOne(scoped({ _id: record.user })).populate("workSchedule", "workDays leavePolicies name");
    if (owner) await assertLeaveAllowed(owner, record.type, record.startDate, record.days, id);

    await record.save();
    return LeaveRequest.findById(id)
      .populate("user", "name email designation")
      .populate("reviewedBy", "name email");
  }

  /**
   * Approve or reject a request. Separate from update() so it can be gated on
   * the `approve` permission — previously both went through one method, so
   * anyone with `edit` could approve by PUTting a status.
   */
  async review(id: string, input: ReviewLeaveInput, reviewerId: string, reviewerRole: ReviewerRole) {
    const record = await LeaveRequest.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Leave request not found"), { statusCode: 404 });
    if (record.status !== "pending") {
      throw Object.assign(new Error("This request has already been reviewed"), { statusCode: 400 });
    }
    assertNotSelfReview(record.user, reviewerId);

    if (input.reviewNote !== undefined) record.reviewNote = input.reviewNote ?? undefined;

    const outcome = resolveReviewOutcome(
      record.approvalSteps, record.workflowStep, input.status, input.reviewNote, reviewerRole
    );
    record.approvalTrail = [...(record.approvalTrail ?? []), outcome.trailEntry];
    if (outcome.advance) {
      // Still pending — waiting on the next step.
      record.workflowStep = (record.workflowStep ?? 1) + 1;
    } else {
      record.status = input.status;
      record.reviewedBy = reviewerId as never;
      record.reviewedAt = new Date();
    }

    await record.save();
    return LeaveRequest.findById(id)
      .populate("user", "name email designation")
      .populate("reviewedBy", "name email");
  }

  async remove(id: string) {
    const record = await LeaveRequest.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Leave request not found"), { statusCode: 404 });
    return { message: "Leave request deleted successfully" };
  }

  /** Self-service — the requester withdraws their own still-pending request. */
  async withdraw(id: string, userId: string) {
    const record = await LeaveRequest.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Leave request not found"), { statusCode: 404 });
    if (String(record.user) !== String(userId)) {
      throw Object.assign(new Error("You can only withdraw your own leave request"), { statusCode: 403 });
    }
    if (record.status !== "pending") {
      throw Object.assign(new Error("Only a pending request can be withdrawn"), { statusCode: 400 });
    }
    record.status = "cancelled";
    await record.save();
    return LeaveRequest.findById(id).populate("user", "name email designation");
  }
}

/**
 * What a person may request this month, and how much of it is left.
 *
 * The leave form asked for none of this: it offered every type in the enum to
 * everyone, so a request could only fail after it had been filled in. Returning
 * the schedule's list lets the form show the menu that actually applies.
 */
export async function leaveOptionsFor(userId: string, month?: string) {
  const user = await User.findOne(scoped({ _id: userId })).populate("workSchedule", "name workDays leavePolicies");
  if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });

  const schedule = user.workSchedule as
    | { name?: string; leavePolicies?: Array<{ type: LeaveType; label?: string; monthlyDays: number; paid: boolean }> }
    | null;
  const policies = schedule?.leavePolicies ?? [];

  // No schedule, or one configured before leave policies existed: every type
  // stays available, matching how the form behaved before.
  if (!policies.length) {
    return { scheduleName: schedule?.name ?? null, unrestricted: true, options: [] };
  }

  const ref = month ? new Date(`${month}-01T00:00:00.000Z`) : new Date();
  const monthStart = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 1));

  const booked = await LeaveRequest.find(scoped({
    user: userId,
    status: { $in: ["pending", "approved"] },
    startDate: { $gte: monthStart, $lt: monthEnd },
  })).select("type days").lean();

  const usedByType = new Map<string, number>();
  for (const b of booked) usedByType.set(b.type, (usedByType.get(b.type) ?? 0) + (b.days || 0));

  return {
    scheduleName: schedule?.name ?? null,
    unrestricted: false,
    options: policies.map((p) => {
      const used = Math.round((usedByType.get(p.type) ?? 0) * 100) / 100;
      return {
        type: p.type,
        // The schedule's own name for it, so a custom type reads properly.
        label: p.label?.trim() || LEAVE_TYPE_LABEL[p.type] || p.type,
        monthlyDays: p.monthlyDays,
        paid: p.paid !== false,
        used,
        remaining: Math.max(0, Math.round((p.monthlyDays - used) * 100) / 100),
      };
    }),
  };
}
