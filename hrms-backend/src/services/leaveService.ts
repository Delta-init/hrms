import { LeaveRequest } from "../models/LeaveRequest.js";
import { Employee } from "../models/Employee.js";
import { hasLeftFilter } from "../utils/employeeStatus.js";
import { User } from "../models/User.js";
import { Holiday } from "../models/Holiday.js";
import type { CreateLeaveInput, UpdateLeaveInput, ReviewLeaveInput, SetLeaveStatusInput } from "../validations/leaveValidation.js";
import { assertMonthEditable } from "./payrollBatchService.js";
import type { PaginationQuery, LeaveType } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { DEFAULT_WORK_DAYS } from "../utils/schedule.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { compOffBalanceFor } from "./compOffService.js";
import { beginWorkflowState, resolveReviewOutcome, assertNotSelfReview } from "./approvalWorkflowService.js";
import { notifyDepartmentHead } from "./departmentHeadService.js";
import { holidayScope, workModeOfUser } from "../utils/holidayScope.js";
import { notifyReviewed } from "./reviewNotifier.js";
import { watchersFor } from "./watchers.js";
import { notify } from "./notificationService.js";
import { putObject } from "./uploadService.js";
import { signedFileUrl } from "../utils/fileUrl.js";

/**
 * Certified Sick Leave — sick leave with no allowance, held to a medical
 * certificate. Applied for today only; the certificate is due five hours
 * after applying. None by then and it becomes unpaid leave; with one, the
 * usual approvers decide — approved is paid, rejected is unpaid.
 */
export const CERTIFIED_SICK = "certified_sick";
export const CERTIFICATE_WINDOW_MS = 5 * 3600_000;
/** Types with no allowance to run out of. */
const UNLIMITED = new Set([CERTIFIED_SICK]);

/** A request as the screens read it: the certificate as a short-lived link. */
function withCertificateLink<T extends { certificate?: { key?: string } | null }>(r: T): T & { certificateUrl?: string | null } {
  return r?.certificate?.key ? { ...r, certificateUrl: signedFileUrl(r.certificate.key) } : r;
}
import { env } from "../config/env.js";
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

type ScheduleRef = { _id?: unknown; name?: string; workDays?: number[] } | null;

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

  // A longer request needs more warning than a single day off — but only
  // longer than the policy's own threshold, and only where a notice period is
  // actually set. Compared in whole UTC days, the same footing every other
  // date in this file is counted on.
  if (policy.minNoticeDays > 0 && days > policy.noticeThresholdDays) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const startDay = new Date(startDate);
    startDay.setUTCHours(0, 0, 0, 0);
    const daysAhead = Math.round((startDay.getTime() - today.getTime()) / 86_400_000);
    if (daysAhead < policy.minNoticeDays) {
      const earliestFrom = new Date(today.getTime() + policy.minNoticeDays * 86_400_000);
      throw Object.assign(
        new Error(
          `${policy.label} longer than ${policy.noticeThresholdDays} day${policy.noticeThresholdDays === 1 ? "" : "s"} ` +
          `needs ${policy.minNoticeDays} days' notice — the earliest start date is ${earliestFrom.toISOString().slice(0, 10)}`
        ),
        { statusCode: 400 }
      );
    }
  }

  if (UNLIMITED.has(type)) return;
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
  [CERTIFIED_SICK]: "Certified sick leave",
  maternity: "Maternity leave", paternity: "Paternity leave", wfh: "Work from home", comp_off: "Comp-off",
};

export class LeaveService {
  /** Working days in [start,end], excluding non-work-days (weekends) and org holidays. */
  private async countWorkingDays(
    start: Date,
    end: Date,
    workDays: number[],
    /**
     * Whose calendar to count against.
     *
     * Without it a Kerala holiday shortens a Dubai employee's leave request by
     * a day they would actually have worked — they ask for five days, are
     * charged four, and turn up to a company that expected them.
     */
    workMode?: "office" | "wfh" | null,
    /** Narrows a work-mode holiday down to one schedule's own calendar — see holidayScope. */
    scheduleId?: unknown
  ): Promise<number> {
    const su = new Date(Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth(), new Date(start).getUTCDate()));
    const eu = new Date(Date.UTC(new Date(end).getUTCFullYear(), new Date(end).getUTCMonth(), new Date(end).getUTCDate()));
    const holidays = await Holiday.find(scoped({ date: { $gte: su, $lte: eu }, ...(await holidayScope(workMode, scheduleId)) })).select("date").lean();
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

    const certified = input.type === CERTIFIED_SICK;
    if (certified) {
      // Today only, where they are — the day they are ill, applied for that morning.
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: input.timeZone || "Asia/Dubai" }).format(new Date());
      const day = (d: Date) => new Date(d).toISOString().slice(0, 10);
      if (day(input.startDate) !== today || day(input.endDate) !== today) {
        throw Object.assign(new Error("Certified Sick Leave is for today only — apply on the day you are ill"), { statusCode: 400 });
      }
    }

    const schedule = await scheduleFor(input.user, user);
    const days = input.halfDay
      ? 0.5
      : await this.countWorkingDays(input.startDate, input.endDate, workDaysOf(schedule), await workModeOfUser(input.user), schedule?._id);

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
      // A certified request always starts waiting — for its certificate first.
      status: certified ? "pending" : input.status ?? "pending",
      ...(certified ? { certificateDueAt: new Date(Date.now() + CERTIFICATE_WINDOW_MS) } : {}),
      ...workflow,
    });

    // Nothing for the approvers to decide until the certificate is in — they
    // are told when it is uploaded. The employee is told the deadline now.
    if (certified) {
      const due = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: input.timeZone || "Asia/Dubai" })
        .format(new Date(Date.now() + CERTIFICATE_WINDOW_MS));
      await notify({
        users: [String(input.user)],
        kind: "leave",
        title: `Upload your medical certificate by ${due}`,
        body: "Certified Sick Leave needs a medical certificate within 5 hours — without it, the day becomes unpaid leave.",
        href: "/leave",
      });
      return withCertificateLink((await LeaveRequest.findById(leave._id).populate("user", "name email designation").lean())!);
    }

    // The head of their department, if they have one. Awaited rather than
    // fired and forgotten so a mail failure cannot outlive the request that
    // caused it, but it can only ever return false — never throw — so a
    // saved request is never lost to a mail server.
    const day = (d: Date) =>
      new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(d);
    await notifyDepartmentHead({
      requesterUserId: String(input.user),
      requesterName: String(user.name ?? "Somebody in your team"),
      subject: `${user.name ?? "Somebody in your team"} has applied for leave`,
      headline:
        `<strong>${user.name ?? "Somebody in your team"}</strong> has applied for ` +
        `${days} day${days === 1 ? "" : "s"} of ${String(input.type).replace(/_/g, " ")} leave.`,
      rows: [
        ["From", day(input.startDate)],
        ["To", day(input.endDate)],
        ["Days", String(days)],
        ["Type", String(input.type).replace(/_/g, " ")],
        ...(input.reason ? ([["Reason", String(input.reason)]] as Array<[string, string]>) : []),
      ],
      link: `${env.CLIENT_URL}/approvals`,
    });

    // And in the app, to everybody who could decide it — HR and, where there
    // is one, the department head. The head is emailed above as well; the rest
    // are not, because a mail per application to every possible approver is how
    // an inbox stops being read.
    await notify({
      users: await watchersFor("leave", String(input.user)),
      kind: "leave",
      title: `${user.name ?? "Someone"} applied for ${days} day${days === 1 ? "" : "s"} of ${String(input.type).replace(/_/g, " ")} leave`,
      body: `${day(input.startDate)} – ${day(input.endDate)}${input.reason ? ` · ${input.reason}` : ""}`,
      href: "/approvals",
      actor: input.user,
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
  /** Logins of people who have left — their pending requests are nobody's to decide. */
  private async leaverUserIds() {
    const rows = await Employee.find({ ...orgFilter(), status: hasLeftFilter(), user: { $ne: null } }).select("user").lean();
    return rows.map((r) => r.user);
  }

  async pendingCount(): Promise<number> {
    return LeaveRequest.countDocuments(scoped({ status: "pending", user: { $nin: await this.leaverUserIds() } }));
  }

  async list(query: LeaveQuery) {
    const { page, limit, skip } = parsePagination(query, 50, 200);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.user) {
      const userIds = query.user.split(",").map((id) => id.trim()).filter(Boolean);
      if (userIds.length === 1) filter.user = userIds[0];
      else if (userIds.length > 1) filter.user = { $in: userIds };
    }
    if (query.status) filter.status = query.status;
    // The pending queue is for people still here; a leaver's history stays in
    // the other views, and anyone asked for by name is shown.
    if (query.status === "pending" && !query.user) filter.user = { $nin: await this.leaverUserIds() };
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
        .populate("statusHistory.by", "name")
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(limit)
        .lean(),
      LeaveRequest.countDocuments(filter),
    ]);

    return { records: records.map((r) => withCertificateLink(r as never)), pagination: buildPagination(total, page, limit) };
  }

  /** Current user's own leave requests (self-service). */
  async listMine(userId: string, query: LeaveQuery) {
    return this.list({ ...query, user: userId });
  }

  async getById(id: string) {
    const record = await LeaveRequest.findOne(scoped({ _id: id }))
      .populate("user", "name email designation")
      .populate("reviewedBy", "name email")
      .lean();
    if (!record) throw Object.assign(new Error("Leave request not found"), { statusCode: 404 });
    return withCertificateLink(record as never);
  }

  /**
   * The employee's medical certificate for a Certified Sick Leave request —
   * theirs, still pending, and before the deadline. Replacing it before a
   * decision is fine. The approvers are told it has arrived.
   */
  async uploadCertificate(id: string, userId: string, file: { buffer: Buffer; mimetype: string; originalname: string; size: number }) {
    const record = await LeaveRequest.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Leave request not found"), { statusCode: 404 });
    if (String(record.user) !== String(userId)) throw Object.assign(new Error("Only your own request takes your certificate"), { statusCode: 403 });
    if (record.type !== CERTIFIED_SICK) throw Object.assign(new Error("Only Certified Sick Leave takes a medical certificate"), { statusCode: 400 });
    if (record.status !== "pending") throw Object.assign(new Error("This request has already been decided"), { statusCode: 400 });
    if (record.certificateDueAt && record.certificateDueAt.getTime() < Date.now()) {
      throw Object.assign(new Error("The 5 hours for the certificate have passed"), { statusCode: 400 });
    }
    const safe = (file.originalname || "certificate").replace(/[^\w.-]+/g, "_").slice(-120);
    const key = `${String(getOrgId() ?? "global")}/leave-certificates/${String(record._id)}/${Date.now()}-${safe}`;
    await putObject(key, file.buffer, file.mimetype);
    const first = !record.certificate;
    record.certificate = { key, fileName: file.originalname, mimeType: file.mimetype, size: file.size, uploadedAt: new Date() } as never;
    await record.save();

    if (first) {
      const who = await User.findById(record.user).select("name").lean<{ name?: string } | null>();
      await notify({
        users: await watchersFor("leave", String(record.user)),
        kind: "leave",
        title: `${who?.name ?? "Someone"} — certified sick leave to approve`,
        body: "Medical certificate uploaded. Approved is paid; rejected becomes unpaid leave.",
        href: "/approvals",
        actor: record.user,
      });
    }
    return this.getById(String(record._id));
  }

  /** Edit a request's details. Cannot change status — see review(). */
  async update(id: string, input: UpdateLeaveInput) {
    {
      const current = await LeaveRequest.findOne(scoped({ _id: id })).select("type").lean<{ type?: string } | null>();
      if (current?.type === CERTIFIED_SICK || (input as { type?: string }).type === CERTIFIED_SICK) {
        throw Object.assign(new Error("Certified Sick Leave can't be edited — withdraw it and apply again"), { statusCode: 400 });
      }
    }
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
    const recordSchedule = await scheduleFor(record.user, subject ?? undefined);
    record.days = record.halfDay
      ? 0.5
      : await this.countWorkingDays(
          record.startDate,
          record.endDate,
          workDaysOf(recordSchedule),
          await workModeOfUser(record.user),
          recordSchedule?._id
        );

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
    const certified = record.type === CERTIFIED_SICK;
    if (certified && input.status === "approved" && !record.certificate) {
      throw Object.assign(new Error("Waiting for the medical certificate — it can be approved once it is uploaded"), { statusCode: 400 });
    }

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
      // Certified sick, refused: still leave, but unpaid.
      if (certified && input.status === "rejected") {
        record.status = "approved";
        record.type = "unpaid";
        record.convertedFrom = CERTIFIED_SICK;
        record.conversionReason = "rejected";
      }
    }

    await record.save();

    // Only once it is settled. A request that has advanced to the next step of
    // a workflow has not been approved, and saying so would be a lie the
    // requester acts on — booking a flight against an approval that has not
    // happened yet.
    if (!outcome.advance) {
      const [reviewer, requester] = await Promise.all([
        User.findById(reviewerId).select("name").lean(),
        User.findById(record.user).select("name").lean(),
      ]);
      const day = (d?: Date | null) =>
        d ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(d) : "—";
      const approved = record.status === "approved" && record.conversionReason !== "rejected";
      if (record.conversionReason === "rejected") {
        record.reviewNote = [record.reviewNote, "Certified sick leave not approved — counted as unpaid leave."].filter(Boolean).join(" ");
      }
      await notifyReviewed({
        userId: record.user,
        subject: "Leave request",
        approved,
        details: [
          { label: "From", value: day(record.startDate) },
          { label: "To", value: day(record.endDate) },
          { label: "Days", value: String(record.days ?? "") },
          { label: "Type", value: String(record.type ?? "").replace(/_/g, " ") },
        ],
        note: record.reviewNote,
        path: "/leave",
        kind: "leave",
        reviewer: { id: reviewerId, name: reviewer?.name },
        // HR and the head both see this queue and either could have decided it.
        // Telling both closes it for whoever did not.
        watchers: await watchersFor("leave", String(record.user)),
      });

      // The head/manager mail, on the same terms as the one they got when this
      // was raised: whoever asked to know when their team applies presumably
      // also wants to know how it was settled, not just that it happened.
      const requesterName = String(requester?.name ?? "Someone in your team");
      await notifyDepartmentHead({
        requesterUserId: String(record.user),
        requesterName,
        subject: `${requesterName}'s leave request was ${approved ? "approved" : "rejected"}`,
        headline:
          `<strong>${requesterName}'s</strong> leave request (${day(record.startDate)} – ${day(record.endDate)}) was ` +
          `<strong style="color:${approved ? "#059669" : "#dc2626"}">${approved ? "approved" : "rejected"}</strong>` +
          `${reviewer?.name ? ` by ${reviewer.name}` : ""}.`,
        rows: [
          ["From", day(record.startDate)],
          ["To", day(record.endDate)],
          ["Days", String(record.days ?? "")],
          ["Type", String(record.type ?? "").replace(/_/g, " ")],
          ...(record.reviewNote ? ([["Note", String(record.reviewNote)]] as Array<[string, string]>) : []),
        ],
        link: `${env.CLIENT_URL}/leave`,
        heading: approved ? "Approved" : "Rejected",
        ctaLabel: "View it",
        accentColor: approved ? "#059669" : "#dc2626",
      });
    }
    return LeaveRequest.findById(id)
      .populate("user", "name email designation")
      .populate("reviewedBy", "name email");
  }

  /**
   * HR changing a request's status by hand — any status to any other, with a
   * note. Separate from review(), which only settles a pending request through
   * its workflow; this is the correction afterwards (a cancellation made in
   * error, an approval that should not stand). Gated on `leave.approve` by the
   * route, never on heading a department, and never on one's own leave.
   *
   * Approving holds to what approving always does: no overlap with another
   * live request, within the balance, and Certified Sick only with its
   * certificate. Refusing Certified Sick still makes it unpaid leave.
   */
  async setStatus(id: string, input: SetLeaveStatusInput, actorId: string) {
    const record = await LeaveRequest.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Leave request not found"), { statusCode: 404 });
    assertNotSelfReview(record.user, actorId);
    const from = record.status;
    const to = input.status;
    if (from === to && !(to === "rejected" && record.type === CERTIFIED_SICK)) {
      throw Object.assign(new Error(`This request is already ${to}`), { statusCode: 400 });
    }

    // A month already with accounts has been paid on these figures.
    const monthOf = (d: Date) => new Date(d).toISOString().slice(0, 7);
    for (const m of new Set([monthOf(record.startDate), monthOf(record.endDate)])) await assertMonthEditable(m, "this leave");

    const certified = record.type === CERTIFIED_SICK;
    if (to === "approved" || to === "pending") {
      const clash = await LeaveRequest.findOne(scoped({
        _id: { $ne: record._id }, user: record.user, status: { $in: ["pending", "approved"] },
        startDate: { $lte: record.endDate }, endDate: { $gte: record.startDate },
      })).select("_id").lean();
      if (clash) throw Object.assign(new Error("Another live request covers these dates — cancel that one first"), { statusCode: 409 });
    }
    if (to === "approved") {
      if (certified && !record.certificate) {
        throw Object.assign(new Error("No medical certificate on this request — it can't be approved as Certified Sick Leave"), { statusCode: 400 });
      }
      const owner = await User.findOne(scoped({ _id: record.user })).populate("workSchedule", "workDays name");
      await assertLeaveAllowed(record.user, (await scheduleFor(record.user, owner ?? undefined))?.name, record.type, record.startDate, record.days, id);
    }

    record.status = to;
    if (certified && to === "rejected") {
      record.status = "approved";
      record.type = "unpaid";
      record.convertedFrom = CERTIFIED_SICK;
      record.conversionReason = "rejected";
    }
    if (to === "approved" || to === "rejected") {
      record.reviewedBy = actorId as never;
      record.reviewedAt = new Date();
    }
    record.statusHistory = [...(record.statusHistory ?? []), { from, to: record.status === "approved" && to === "rejected" ? "unpaid" : to, by: actorId as never, note: input.note, at: new Date() }];
    await record.save();

    const day = (d: Date) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(d);
    const span = +record.startDate === +record.endDate ? day(record.startDate) : `${day(record.startDate)} – ${day(record.endDate)}`;
    const said = record.conversionReason === "rejected" && to === "rejected" ? "not approved — counted as unpaid leave" : to;
    await notify({
      users: [String(record.user)],
      actor: actorId,
      kind: "leave",
      tone: to === "approved" ? "positive" : to === "pending" ? "neutral" : "negative",
      title: `Your ${span} leave is now ${said}`,
      body: `HR changed it from ${from}. ${input.note}`,
      href: "/leave",
    });

    return LeaveRequest.findById(id)
      .populate("user", "name email designation")
      .populate("reviewedBy", "name email")
      .populate("statusHistory.by", "name");
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
    // Comp-off is never policy-driven — see assertLeaveAllowed — so a policy
    // row for it (however it got created) is never offered here. The form
    // shows the real comp-off ledger balance for that type instead.
    if (p.type === "comp_off") continue;
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
      // No allowance to run out of — the form says "no limit" instead of a count.
      unlimited: UNLIMITED.has(p.type),
    });
  }

  return { scheduleName: schedule?.name ?? null, unrestricted: false, options };
}
