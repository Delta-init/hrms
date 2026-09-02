import { LeaveRequest } from "../models/LeaveRequest.js";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { Holiday } from "../models/Holiday.js";
import type { CreateLeaveInput, UpdateLeaveInput, ReviewLeaveInput } from "../validations/leaveValidation.js";
import type { PaginationQuery, LeaveType } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { DEFAULT_WORK_DAYS } from "../utils/schedule.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { compOffBalanceFor } from "./compOffService.js";
import { beginWorkflowState, resolveReviewOutcome, assertNotSelfReview } from "./approvalWorkflowService.js";
import type { ReviewerRole } from "./approvalWorkflowService.js";
import { parsePagination } from "../utils/query.js";
import {
  policiesForUser, accruedFor, usedInPeriod, carriedForward, periodWindow, leaveLabel, eligibilityFor,
  type EffectivePolicy,
} from "./leavePolicyResolver.js";

interface LeaveQuery extends PaginationQuery {
  user?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
}

type ScheduleRef = { name?: string; workDays?: number[] } | null;

/**
 * The schedule governing someone: the one on their login, else the one on their
 * employee record.
 *
 * Reading only the login meant a schedule assigned from the employee form was
 * invisible here, so leave silently fell back to the default and counted a
 * different number of days than payroll did for the very same month.
 */
async function scheduleFor(userId: unknown, loaded?: { workSchedule?: unknown }): Promise<ScheduleRef> {
  const fromUser = loaded?.workSchedule as ScheduleRef;
  if (fromUser?.workDays?.length) return fromUser;
  const emp = await Employee.findOne(scoped({ user: userId }))
    .populate("workSchedule", "name workDays")
    .select("workSchedule");
  return ((emp?.workSchedule as ScheduleRef) ?? fromUser) ?? null;
}
const workDaysOf = (schedule: ScheduleRef): number[] =>
  schedule?.workDays?.length ? schedule.workDays : DEFAULT_WORK_DAYS;

/** A half-day leave must fall on a single date. */
function assertHalfDayIsSingleDay(halfDay: boolean, start: Date, end: Date) {
  if (halfDay && new Date(start).setHours(0, 0, 0, 0) !== new Date(end).setHours(0, 0, 0, 0)) {
    throw Object.assign(new Error("A half-day leave must be a single date"), { statusCode: 400 });
  }
}

/** Joining date decides how much of a yearly allowance has accrued yet. */
async function joiningDateFor(userId: unknown): Promise<Date | null> {
  const emp = await Employee.findOne(scoped({ user: userId })).select("joiningDate").lean();
  return emp?.joiningDate ? new Date(emp.joiningDate) : null;
}

/** What is left of `policy` for the period `startDate` falls in. */
async function remainingFor(
  policy: EffectivePolicy,
  userId: unknown,
  startDate: Date,
  excludeId: string | null
): Promise<{ remaining: number; used: number; accrued: number }> {
  const joiningDate = await joiningDateFor(userId);
  const accrued = accruedFor(policy, joiningDate, startDate);
  // Pending requests count: two requests that each fit would otherwise both be
  // accepted and together exceed the allowance.
  const used = await usedInPeriod(userId, policy.type, policy.period, startDate, {
    includePending: true,
    excludeId,
  });
  const carried = policy.period === "year"
    ? carriedForward(policy, joiningDate, startDate.getUTCFullYear(),
        await usedInPeriod(userId, policy.type, "year", new Date(Date.UTC(startDate.getUTCFullYear() - 1, 0, 1))))
    : 0;
  return { remaining: Math.round((accrued + carried - used) * 100) / 100, used, accrued };
}

/**
 * Refuse leave no policy grants.
 *
 * A leave type can only be requested if a policy covers it — either the
 * person's own work schedule, or the organization-wide default. The amount left
 * is the same figure the balance card shows, so the form, the gate and the
 * balance can never disagree.
 *
 * Comp-off is the exception: it is earned by working extra rather than granted
 * by a policy, and is checked against the comp-off ledger by the caller.
 *
 * `excludeId` lets an edit ignore the request being edited, or amending one by
 * a day would count it twice.
 */
async function assertLeaveAllowed(
  userId: unknown,
  scheduleName: string | undefined,
  type: string,
  startDate: Date,
  days: number,
  excludeId: string | null
) {
  if (type === "comp_off") return;

  const policies = await policiesForUser(userId);
  const where = scheduleName ? `on ${scheduleName}` : "for this employee";
  if (!policies.length) {
    throw Object.assign(
      new Error(`No leave policies are set up ${where}. Add one under Leave → Balances before requesting leave.`),
      { statusCode: 400 }
    );
  }

  const policy = policies.find((p) => p.type === type);
  if (!policy) {
    throw Object.assign(
      new Error(`${leaveLabel(type)} isn't available ${where}`),
      { statusCode: 400 }
    );
  }

  // Not yet served long enough: say when they qualify rather than reporting
  // zero days left, which reads like they have spent an allowance they never had.
  const eligibility = eligibilityFor(policy, await joiningDateFor(userId), startDate);
  if (!eligibility.eligible) {
    const on = eligibility.eligibleOn!.toISOString().slice(0, 10);
    const months = policy.eligibleAfterMonths;
    throw Object.assign(
      new Error(
        `${policy.label} opens up after ${months} month${months === 1 ? "" : "s"} of service — from ${on}`
      ),
      { statusCode: 400 }
    );
  }

  const { remaining, used } = await remainingFor(policy, userId, startDate, excludeId);
  if (days > remaining) {
    const per = policy.period === "month" ? "this month" : "this year";
    throw Object.assign(
      new Error(
        `Only ${remaining} day${remaining === 1 ? "" : "s"} of ${policy.label} left ${per} ` +
        `(${policy.days}/${policy.period}, ${used} already booked)`
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
    const user = await User.findOne(scoped({ _id: input.user })).populate("workSchedule", "workDays name");
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

    const schedule = await scheduleFor(input.user, user);
    const days = input.halfDay ? 0.5 : await this.countWorkingDays(input.startDate, input.endDate, workDaysOf(schedule));

    await assertLeaveAllowed(input.user, schedule?.name, input.type, input.startDate, days, null);

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

  /**
   * How many requests are sitting unanswered, for the badge and the digest.
   *
   * A count rather than the rows: the sidebar needs a number and asking for a
   * page of requests to length it would pull the whole queue into memory on
   * every navigation. Scoped like every other read here, so one tenant's queue
   * is never counted into another's.
   */
  async pendingCount(): Promise<number> {
    return LeaveRequest.countDocuments(scoped({ status: "pending" }));
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
    record.days = record.halfDay ? 0.5 : await this.countWorkingDays(record.startDate, record.endDate, workDaysOf(await scheduleFor(record.user, subject ?? undefined)));

    const owner = await User.findOne(scoped({ _id: record.user })).populate("workSchedule", "workDays name");
    await assertLeaveAllowed(record.user, (await scheduleFor(record.user, owner ?? undefined))?.name, record.type, record.startDate, record.days, id);

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
/**
 * What the request form offers this person: the types their policies grant,
 * with how much of each is left. An empty list means nothing is configured for
 * them, and nothing can be requested — the form says so rather than offering
 * types the server would refuse.
 */
export async function leaveOptionsFor(userId: string, month?: string) {
  const user = await User.findOne(scoped({ _id: userId })).populate("workSchedule", "name workDays");
  if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });

  const [schedule, policies] = await Promise.all([
    scheduleFor(userId, user),
    policiesForUser(userId),
  ]);

  // Monthly allowances are read against the month being asked about; yearly
  // ones against the year it falls in.
  const on = month ? new Date(`${month}-01T00:00:00.000Z`) : new Date();
  const joiningDate = await joiningDateFor(userId);

  const options = [];
  for (const p of policies) {
    const accrued = accruedFor(p, joiningDate, on);
    const used = await usedInPeriod(userId, p.type, p.period, on, { includePending: true });
    const carried = p.period === "year"
      ? carriedForward(p, joiningDate, on.getUTCFullYear(),
          await usedInPeriod(userId, p.type, "year", new Date(Date.UTC(on.getUTCFullYear() - 1, 0, 1))))
      : 0;
    const eligibility = eligibilityFor(p, joiningDate, on);
    options.push({
      type: p.type,
      label: p.label,
      days: p.days,
      period: p.period,
      paid: p.paid,
      used,
      remaining: Math.max(0, Math.round((accrued + carried - used) * 100) / 100),
      eligible: eligibility.eligible,
      eligibleOn: eligibility.eligibleOn ? eligibility.eligibleOn.toISOString() : null,
      eligibleAfterMonths: p.eligibleAfterMonths,
    });
  }

  return { scheduleName: schedule?.name ?? null, unrestricted: false, options };
}
