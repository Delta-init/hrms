import { Organization } from "../models/Organization.js";
import { Department } from "../models/Department.js";
import { Employee } from "../models/Employee.js";
import { stillHere } from "../utils/employeeStatus.js";
import { WorkSchedule } from "../models/WorkSchedule.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Attendance } from "../models/Attendance.js";
import { User } from "../models/User.js";
import { RosterAssignment } from "../models/RosterAssignment.js";
import { scheduleOf, leavesIn, type WorkHoursRow, type WorkHoursSchedule } from "../utils/workHours.js";

/**
 * The read-only view of who exists in HRMS, for Delta Finance to map against.
 *
 * Deliberately cross-organization and therefore deliberately *not* built on
 * `scoped()`. Every other service in this codebase narrows to the caller's org
 * via the request-scoped context; this one has no user and no org — the finance
 * server is asking "what organizations are there at all?" so that an
 * administrator can link them. Every query below therefore filters on an
 * explicit `organization` argument, and the org id is always supplied by the
 * caller rather than inferred. Adding a `scoped()` here would silently return
 * nothing; forgetting the explicit filter would leak another tenant's roster.
 *
 * What is NOT exposed here, on purpose: salary and bank details. Mapping needs
 * to know that somebody exists, not what they are paid. Payroll figures cross
 * later, on the payroll-run endpoints, where they belong to a specific month
 * that finance has been handed. `hasBankDetails` is included as a bare boolean
 * because "mapped but unpayable" is exactly the warning the reconcile screen
 * needs before a payroll run, and it discloses nothing.
 */

export interface DirectoryOrganization {
  id: string;
  name: string;
  code: string;
  currency: string;
  timeZone: string;
  status: string;
}

export interface DirectoryDepartment {
  id: string;
  organizationId: string | null;
  name: string;
  code: string;
  status: string;
}

export interface DirectoryEmployee {
  id: string;
  organizationId: string | null;
  employeeCode: string;
  name: string;
  email: string;
  departmentId: string | null;
  designation: string;
  employmentType: string;
  status: string;
  joiningDate: string | null;
  currency: string;
  hasBankDetails: boolean;
  updatedAt: string;
}

export class DirectoryService {
  /** Every organization finance could link a payroll pipeline to. */
  async organizations(): Promise<DirectoryOrganization[]> {
    const orgs = await Organization.find({}).sort({ name: 1 }).lean();
    return orgs.map((o) => ({
      id: String(o._id),
      name: o.name,
      code: o.code,
      currency: o.settings?.currency ?? "AED",
      timeZone: o.settings?.timeZone ?? "Asia/Dubai",
      status: o.status ?? "active",
    }));
  }

  /** Departments belonging to one HRMS organization. */
  async departments(organizationId: string): Promise<DirectoryDepartment[]> {
    const rows = await Department.find({ organization: organizationId }).sort({ name: 1 }).lean();
    return rows.map((d) => ({
      id: String(d._id),
      organizationId: d.organization ? String(d.organization) : null,
      name: d.name,
      code: d.code ?? "",
      status: d.status ?? "active",
    }));
  }

  /**
   * The roster of one HRMS organization.
   *
   * `updatedSince` exists so a re-sync costs one small page rather than the
   * whole company, but the first sync of an org genuinely is everybody — hence
   * the page/limit rather than an unbounded array.
   */
  async employees(
    organizationId: string,
    opts: { updatedSince?: string; page?: number; limit?: number; includeInactive?: boolean } = {}
  ): Promise<{ rows: DirectoryEmployee[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(500, Math.max(1, opts.limit ?? 200));

    const filter: Record<string, unknown> = { organization: organizationId };

    // Leavers are included by default and flagged rather than hidden. A person
    // who left still has a final payslip and still needs their finance-side
    // record deactivated — dropping them from the feed would strand it.
    if (!opts.includeInactive) filter.status = stillHere();

    if (opts.updatedSince) {
      const since = new Date(opts.updatedSince);
      if (!Number.isNaN(since.getTime())) filter.updatedAt = { $gte: since };
    }

    const [rows, total] = await Promise.all([
      Employee.find(filter)
        .select("organization employeeCode name email department designation employmentType status joiningDate currency bank updatedAt")
        .sort({ employeeCode: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Employee.countDocuments(filter),
    ]);

    return {
      rows: rows.map((e) => {
        const bank = (e as { bank?: { ibanIfsc?: string; bankAccountNumber?: string } }).bank;
        return {
          id: String(e._id),
          organizationId: e.organization ? String(e.organization) : null,
          employeeCode: e.employeeCode,
          name: e.name,
          email: e.email ?? "",
          departmentId: e.department ? String(e.department) : null,
          designation: e.designation ?? "",
          employmentType: e.employmentType ?? "full_time",
          status: e.status ?? "active",
          joiningDate: e.joiningDate ? new Date(e.joiningDate).toISOString() : null,
          currency: e.currency ?? "AED",
          hasBankDetails: Boolean(bank?.ibanIfsc || bank?.bankAccountNumber),
          updatedAt: e.updatedAt ? new Date(e.updatedAt as Date).toISOString() : "",
        };
      }),
      total,
      page,
      limit,
    };
  }

  /**
   * Working hours for the people with these emails: their schedule's shift and days (the default, said so, when
   * none is assigned) and their approved leave touching [from, to] (YYYY-MM-DD). For the CS Portal's
   * Mentor Calendar, which knows its mentors by email only — so within `organizationId` when given, else by email
   * wherever they are. Leavers are left out: nobody books time with them.
   */
  async workHours(opts: { emails: string[]; from: string; to: string; organizationId?: string }): Promise<WorkHoursRow[]> {
    const filter: Record<string, unknown> = { email: { $in: opts.emails }, status: stillHere() };
    if (opts.organizationId) filter.organization = opts.organizationId;
    const employees = await Employee.find(filter).select("email name workSchedule user").lean();
    if (!employees.length) return [];

    const scheduleIds = [...new Set(employees.map((e) => (e.workSchedule ? String(e.workSchedule) : "")).filter(Boolean))];
    const schedules = new Map(
      (await WorkSchedule.find({ _id: { $in: scheduleIds } }).lean()).map((w) => [String(w._id), w]),
    );
    // A day either side: leave is stored as instants, and the days it covers are read in its own time zone below.
    const userIds = employees.map((e) => e.user).filter(Boolean);
    const leaves = userIds.length
      ? await LeaveRequest.find({
        user: { $in: userIds },
        status: "approved",
        startDate: { $lte: new Date(new Date(`${opts.to}T00:00:00Z`).getTime() + 2 * 86_400_000) },
        endDate: { $gte: new Date(new Date(`${opts.from}T00:00:00Z`).getTime() - 2 * 86_400_000) },
      }).select("user type startDate endDate halfDay timeZone").lean()
      : [];
    const leavesOf = new Map<string, typeof leaves>();
    for (const l of leaves) leavesOf.set(String(l.user), [...(leavesOf.get(String(l.user)) ?? []), l]);

    return employees.map((e) => ({
      email: e.email ?? "",
      name: e.name,
      schedule: scheduleOf(e.workSchedule ? schedules.get(String(e.workSchedule)) : null),
      leaves: e.user ? leavesIn(leavesOf.get(String(e.user)) ?? [], opts.from, opts.to) : [],
    }));
  }
}

export const directoryService = new DirectoryService();

/** Where somebody is right now, for a sales CRM's live lead split. */
export interface AttendanceNowRow {
  email: string;
  name: string;
  /** in: clocked in, not out yet. leave: on approved leave today and not clocked in. out: anything else. */
  state: "in" | "out" | "leave";
  /** When they clocked in, while in. */
  since: string | null;
  /** Today's approved leave, when there is one. */
  leave: { type: string; halfDay: boolean } | null;
}

/** A clock-in left open longer than this is a forgotten clock-out, not somebody at work. */
const OPEN_FOR_AT_MOST_MS = 18 * 3_600_000;

/**
 * Who is at work now, by email (the user, 2026-10-10): the Sales CRM gives new
 * leads during its shift only to people clocked in here. Clocked in is the
 * HRMS's own open session — a check-in with no check-out yet — begun in the
 * last 18 hours. Leave is approved leave covering today (where the person's
 * schedule keeps its days); working from home is not leave. Somebody clocked
 * in on a half day of leave is at work.
 */
export async function attendanceNow(opts: { emails: string[]; organizationId?: string }): Promise<AttendanceNowRow[]> {
  const filter: Record<string, unknown> = { email: { $in: opts.emails }, status: stillHere() };
  if (opts.organizationId) filter.organization = opts.organizationId;
  const employees = await Employee.find(filter).select("email name user").lean();
  if (!employees.length) return [];
  const userIds = employees.map((e) => e.user).filter(Boolean);
  const now = Date.now();
  const open = userIds.length
    ? await Attendance.find({ user: { $in: userIds }, checkIn: { $ne: null, $gte: new Date(now - OPEN_FOR_AT_MOST_MS) }, checkOut: null })
      .select("user checkIn").sort({ checkIn: -1 }).lean()
    : [];
  const inSince = new Map<string, Date>();
  for (const a of open) if (!inSince.has(String(a.user))) inSince.set(String(a.user), a.checkIn as Date);

  // Today, in Dubai — the sales floor's day; the leave's own days are read in its time zone by workHours.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const hours = await directoryService.workHours({ emails: opts.emails, from: today, to: today, organizationId: opts.organizationId });
  const leaveOf = new Map(hours.map((h) => [h.email.toLowerCase(), h.leaves.find((l) => l.type.toLowerCase() !== "wfh") ?? null]));

  return employees.map((e) => {
    const since = e.user ? inSince.get(String(e.user)) ?? null : null;
    const leave = leaveOf.get(String(e.email ?? "").toLowerCase()) ?? null;
    return {
      email: e.email ?? "",
      name: e.name,
      state: since ? "in" : leave ? "leave" : "out",
      since: since ? since.toISOString() : null,
      leave: leave ? { type: leave.type, halfDay: leave.halfDay } : null,
    };
  });
}

/** Somebody's day, for a sales CRM's Activity and team pages: their shift, and when they clocked in and out. */
export interface AttendanceDayRow {
  email: string;
  name: string;
  /** The shift the day is judged by (a roster's, else the login's, else the default — said so); see attendanceDay. */
  schedule: WorkHoursSchedule;
  /** The day is one of their schedule's working days. */
  workDay: boolean;
  /** That day's record as the HRMS keeps it; null when there is none (never clocked in, nothing marked). */
  attendance: {
    /** present, late, half_day, early_out, on_leave, absent, holiday, weekend or wfh. */
    status: string;
    /** The first clock-in and the last clock-out; lastOut is null while they are still clocked in. */
    firstIn: string | null;
    lastOut: string | null;
    /** Every clock-in and clock-out that day, in order; `out` null for one still open. */
    sessions: Array<{ in: string; out: string | null }>;
    workedMinutes: number;
    lateMinutes: number;
  } | null;
  /** Approved leave covering the day — not working from home, which is `wfh`. */
  leave: { type: string; halfDay: boolean } | null;
  wfh: boolean;
  /**
   * For today (Dubai) only: clocked in now, on leave, or out. Clocked in is a session of the day still open — or a
   * clock-in still open from the last 18 hours (a night shift begun yesterday, as /attendance-now reads it) that came
   * after the day's last clock-out. Null for another day, and for a row the HRMS couldn't read.
   */
  now: "in" | "out" | "leave" | null;
}

const DUBAI_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" });
const DAY_MS = 86_400_000;

type ScheduleRef = { _id: unknown } | string | null | undefined;
const refId = (v: ScheduleRef): string => (v ? String(typeof v === "object" && "_id" in v ? v._id : v) : "");

/**
 * Somebody's day by email (the user, 2026-10-15: "show the HRMS shift and the clock-in and clock-out times in the
 * sales CRM"): their shift, and that day's record — the first clock-in, the last clock-out, every session, worked and
 * late minutes, the status. The record is matched on the day as written where the person works (`localDay`), as the
 * HRMS's own jobs read it; two records on one day (a time zone changed mid-day) are read as one.
 *
 * Every part of a row is that employee's own, joined by their login — never by email, so two employee records that
 * share an address can't trade shifts, leave or "now". The shift is the one the HRMS judged the day against, as
 * clock-in resolves it (workScheduleService.resolveWorkScheduleForUser): the roster assignment covering the first
 * clock-in (or, nobody punched, the day's start, as the HRMS's calendar reads it), else their own schedule, else the
 * default. Where and how they punched (address, device, face match) is not given out. Leavers are left out. A record
 * that can't be read costs only its own row. Read only.
 */
export async function attendanceDay(opts: { emails: string[]; day: string; organizationId?: string }): Promise<AttendanceDayRow[]> {
  const filter: Record<string, unknown> = { email: { $in: opts.emails }, status: stillHere() };
  if (opts.organizationId) filter.organization = opts.organizationId;
  const employees = await Employee.find(filter).select("email name user workSchedule").lean();
  if (!employees.length) return [];

  const nowMs = Date.now();
  const isToday = opts.day === DUBAI_DAY.format(new Date(nowMs));
  const dayStart = new Date(`${opts.day}T00:00:00.000Z`).getTime();
  // An id that isn't one (raw-imported junk) is no login, not a failed batch.
  const isId = (v: string) => /^[a-f\d]{24}$/i.test(v);
  const loginOf = (e: { user?: unknown }) => (e.user && isId(String(e.user)) ? String(e.user) : "");
  const userIds = [...new Set(employees.map(loginOf).filter(Boolean))];
  const none = Promise.resolve([] as never[]);

  const [users, records, open, leaveDocs, rosters] = await Promise.all([
    userIds.length ? User.find({ _id: { $in: userIds } }).select("workSchedule").lean() : none,
    userIds.length
      ? Attendance.find({ user: { $in: userIds }, localDay: opts.day })
        .select("user status checkIn checkOut sessions.checkIn sessions.checkOut workedMinutes lateMinutes").lean()
      : none,
    // Clocked in now, as /attendance-now reads it: a check-in from the last 18 hours with no check-out yet.
    isToday && userIds.length
      ? Attendance.find({ user: { $in: userIds }, checkIn: { $ne: null, $gte: new Date(nowMs - OPEN_FOR_AT_MOST_MS) }, checkOut: null })
        .select("user checkIn localDay").lean()
      : none,
    // A day either side, as workHours reads leave: it is stored as instants, its days read in its own time zone below.
    userIds.length
      ? LeaveRequest.find({
        user: { $in: userIds },
        status: "approved",
        startDate: { $lte: new Date(dayStart + 2 * DAY_MS) },
        endDate: { $gte: new Date(dayStart - 2 * DAY_MS) },
      }).select("user type startDate endDate halfDay timeZone").lean()
      : none,
    userIds.length
      ? RosterAssignment.find({
        user: { $in: userIds },
        effectiveFrom: { $lte: new Date(dayStart + 2 * DAY_MS) },
        $or: [{ effectiveTo: null }, { effectiveTo: { $gte: new Date(dayStart - 2 * DAY_MS) } }],
      }).select("user workSchedule effectiveFrom effectiveTo").sort({ effectiveFrom: -1 }).lean()
      : none,
  ]);

  const group = <T extends { user?: unknown }>(rows: T[]) => {
    const by = new Map<string, T[]>();
    for (const r of rows) by.set(String(r.user), [...(by.get(String(r.user)) ?? []), r]);
    return by;
  };
  const recordsOf = group(records);
  const leavesOf = group(leaveDocs);
  const rostersOf = group(rosters);
  // The latest clock-in still open from the last 18 hours on another day's record, per person — a night shift begun
  // yesterday, or one past midnight in the person's own zone. The day's own records go by their sessions alone.
  const openSince = new Map<string, number>();
  for (const a of open) {
    if (a.localDay === opts.day) continue;
    const t = new Date(a.checkIn as Date).getTime();
    if (!Number.isNaN(t) && t > (openSince.get(String(a.user)) ?? 0)) openSince.set(String(a.user), t);
  }
  const userSchedule = new Map(users.map((u) => [String(u._id), refId(u.workSchedule as ScheduleRef)]));
  const scheduleIds = [...new Set([
    ...rosters.map((a) => refId(a.workSchedule as ScheduleRef)),
    ...userSchedule.values(),
    ...employees.map((e) => refId(e.workSchedule as ScheduleRef)),
  ].filter(isId))];
  const schedules = new Map(
    (scheduleIds.length ? await WorkSchedule.find({ _id: { $in: scheduleIds } }).lean() : []).map((w) => [String(w._id), w]),
  );

  // The weekday of a calendar date is the same wherever it is read.
  const weekday = new Date(`${opts.day}T12:00:00.000Z`).getUTCDay();
  const iso = (d: unknown) => {
    const t = d ? new Date(d as Date).getTime() : NaN;
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  };
  const knownZone = (tz: unknown) => {
    try {
      return typeof tz === "string" && !!tz && !!new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    } catch {
      return false;
    }
  };
  type Rec = (typeof records)[number];
  const sessionsOf = (r: Rec) => (r.sessions?.length ? r.sessions : r.checkIn ? [{ checkIn: r.checkIn, checkOut: r.checkOut }] : [])
    // A clock-out that is there but can't be read is not "still open": that session is left out, as an unreadable
    // clock-in is.
    .filter((x) => !x.checkOut || iso(x.checkOut) !== null)
    .map((x) => ({ in: iso(x.checkIn), out: iso(x.checkOut) }))
    .filter((x): x is { in: string; out: string | null } => x.in !== null);
  const minutes = (v: unknown) => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  const rowOf = (e: (typeof employees)[number]): AttendanceDayRow => {
    const uid = loginOf(e);
    const recs = uid ? recordsOf.get(uid) ?? [] : [];
    const sessions = recs.flatMap(sessionsOf).sort((a, b) => a.in.localeCompare(b.in));
    // Still in while any session is open; else out at the latest clock-out (merged records can overlap).
    const open = sessions.some((x) => x.out === null);
    const lastOut = open ? null : sessions.reduce<string | null>((max, x) => (x.out && (!max || x.out > max) ? x.out : max), null);
    // The record the day began with sets its status and lateness; worked time is the day's.
    const primary = [...recs].sort((a, b) => (sessionsOf(a)[0]?.in ?? "~").localeCompare(sessionsOf(b)[0]?.in ?? "~"))[0];

    // The shift the day is judged by: the roster covering the first clock-in (what clock-in used), or — nobody punched —
    // covering the day as the HRMS's calendar reads it (its start, UTC: a roster's last day is still rostered); else
    // the login's own; else the default.
    const at = sessions[0] ? Date.parse(sessions[0].in) : dayStart;
    const roster = (rostersOf.get(uid) ?? []).find((a) =>
      new Date(a.effectiveFrom as Date).getTime() <= at && (!a.effectiveTo || new Date(a.effectiveTo as Date).getTime() >= at));
    const scheduleId = (roster && schedules.has(refId(roster.workSchedule as ScheduleRef)) ? refId(roster.workSchedule as ScheduleRef) : "")
      || (uid ? userSchedule.get(uid) ?? "" : refId(e.workSchedule as ScheduleRef));
    const schedule = scheduleOf(scheduleId ? schedules.get(scheduleId) : null);

    const leaveDocsOf = (leavesOf.get(uid) ?? []).map((l) => (knownZone(l.timeZone) ? l : { ...l, timeZone: undefined }));
    const leaves = uid ? leavesIn(leaveDocsOf, opts.day, opts.day) : [];
    const leave = leaves.find((l) => l.type.toLowerCase() !== "wfh") ?? null;
    const latestOut = sessions.reduce((max, x) => (x.out && Date.parse(x.out) > max ? Date.parse(x.out) : max), 0);
    const nightShift = openSince.get(uid) ?? 0;
    const clockedIn = sessions.some((x) => x.out === null && Date.parse(x.in) >= nowMs - OPEN_FOR_AT_MOST_MS)
      || (nightShift > 0 && nightShift > latestOut);
    return {
      email: e.email ?? "",
      name: e.name,
      schedule,
      workDay: schedule.workDays.includes(weekday),
      attendance: primary
        ? {
          status: String(primary.status ?? "present"),
          firstIn: sessions[0]?.in ?? null,
          lastOut,
          sessions,
          workedMinutes: recs.reduce((sum, r) => sum + minutes(r.workedMinutes), 0),
          lateMinutes: minutes(primary.lateMinutes),
        }
        : null,
      leave: leave ? { type: leave.type, halfDay: leave.halfDay } : null,
      wfh: leaves.some((l) => l.type.toLowerCase() === "wfh") || recs.some((r) => r.status === "wfh"),
      // As /attendance-now: clocked in beats leave (a half day's leave, then at work), and leave beats out.
      now: !isToday ? null : clockedIn ? "in" : leave ? "leave" : "out",
    };
  };

  // A record the runtime can't read must not cost the other 199 their rows: that one person comes back bare.
  return employees.map((e) => {
    try {
      return rowOf(e);
    } catch (err) {
      console.error(`[attendance-day] could not read ${e.email || String(e._id)}:`, err instanceof Error ? err.message : err);
      const schedule = scheduleOf(null);
      // Bare, and "now" unknown (null) — not a confident "out" the caller would show.
      return { email: e.email ?? "", name: e.name, schedule, workDay: schedule.workDays.includes(weekday), attendance: null, leave: null, wfh: false, now: null };
    }
  });
}
