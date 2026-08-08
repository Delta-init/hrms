import { Attendance } from "../models/Attendance.js";
import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Regularization } from "../models/Regularization.js";
import { Holiday } from "../models/Holiday.js";
import { Organization } from "../models/Organization.js";
import { leavePolicyIndex, leaveLabel } from "./leavePolicyResolver.js";
import type { CreateAttendanceInput, UpdateAttendanceInput } from "../validations/attendanceValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { resolveShift, statusForClockIn, DEFAULT_SCHEDULE, type ShiftSchedule, DEFAULT_WORK_DAYS, localDayKey, todayInTz, zonedTimeToUtc } from "../utils/schedule.js";
import { resolveWorkScheduleForUser, rosterWorkDaysByUser, workDaysForDate } from "./workScheduleService.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { parsePagination } from "../utils/query.js";

/**
 * Start of `value` as a local day in `tz`. A bare YYYY-MM-DD is a calendar day
 * and has to be anchored somewhere; anything more specific is already an
 * instant and is left alone.
 */
function dayBoundary(value: string, tz: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? zonedTimeToUtc(value, "00:00", tz) : new Date(value);
}

interface AttendanceQuery extends PaginationQuery {
  user?: string;
  dateFrom?: string;
  dateTo?: string;
}


export class AttendanceService {
  private applySessions(doc: { checkIn?: Date | null; checkOut?: Date | null; sessions: unknown }, checkIn?: Date | null, checkOut?: Date | null) {
    // Build a single session from top-level check-in/out so worked minutes compute.
    if (checkIn) {
      doc.sessions = [{ checkIn, checkOut: checkOut ?? null }] as never;
    } else {
      doc.sessions = [] as never;
    }
  }

  async create(input: CreateAttendanceInput) {
    // Scope the user to the caller's org so a record can't reference another tenant's user.
    const user = await User.findOne(scoped({ _id: input.user }));
    if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });

    const existing = await Attendance.findOne(scoped({ user: input.user, date: input.date }));
    if (existing) {
      throw Object.assign(
        new Error("An attendance record already exists for this user on that date"),
        { statusCode: 409 }
      );
    }

    const attendance = new Attendance({
      organization: getOrgId(),
      user: input.user,
      date: input.date,
      timeZone: input.timeZone,
      status: input.status,
      lateMinutes: input.lateMinutes ?? 0,
      note: input.note,
    });
    this.applySessions(attendance, input.checkIn, input.checkOut);
    await attendance.save();
    return Attendance.findById(attendance._id).populate("user", "name email designation");
  }

  /** The organization's timezone — what "a day" means for this tenant. */
  private async orgTimeZone(): Promise<string> {
    const org = await Organization.findById(getOrgId()).select("settings.timeZone").lean<{ settings?: { timeZone?: string } } | null>();
    return org?.settings?.timeZone || DEFAULT_SCHEDULE.timeZone;
  }

  async list(query: AttendanceQuery) {
    const { page, limit, skip } = parsePagination(query, 50, 200);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.user) filter.user = query.user;
    if (query.status) filter.status = query.status;
    if (query.dateFrom || query.dateTo) {
      // A day here means a local day, not a UTC instant. Comparing a bare
      // YYYY-MM-DD against the stored local-midnight-in-UTC missed every
      // record east of Greenwich — asking for today returned nothing at all —
      // and `$lte` on the end date cut the last day off at its first second.
      const tz = await this.orgTimeZone();
      const range: Record<string, Date> = {};
      if (query.dateFrom) range.$gte = dayBoundary(query.dateFrom, tz);
      if (query.dateTo) range.$lt = new Date(dayBoundary(query.dateTo, tz).getTime() + 86_400_000);
      filter.date = range;
    }

    const sortable = new Set(["date", "workedMinutes", "lateMinutes", "status", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "date";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      Attendance.find(filter)
        .populate("user", "name email designation")
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(limit)
        .lean(),
      Attendance.countDocuments(filter),
    ]);

    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await Attendance.findOne(scoped({ _id: id })).populate("user", "name email designation");
    if (!record) throw Object.assign(new Error("Attendance record not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateAttendanceInput) {
    const record = await Attendance.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Attendance record not found"), { statusCode: 404 });

    if (input.date !== undefined) record.date = input.date;
    if (input.timeZone !== undefined) record.timeZone = input.timeZone;
    if (input.status !== undefined) record.status = input.status;
    if (input.lateMinutes !== undefined) record.lateMinutes = input.lateMinutes;
    if (input.note !== undefined) record.note = input.note ?? undefined;

    // Rebuild sessions when either check time is supplied in the update.
    if (input.checkIn !== undefined || input.checkOut !== undefined) {
      const checkIn = input.checkIn !== undefined ? input.checkIn : record.checkIn;
      const checkOut = input.checkOut !== undefined ? input.checkOut : record.checkOut;
      this.applySessions(record, checkIn, checkOut);
    }

    await record.save();
    return Attendance.findById(id).populate("user", "name email designation");
  }

  async remove(id: string) {
    const record = await Attendance.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Attendance record not found"), { statusCode: 404 });
    return { message: "Attendance record deleted successfully" };
  }

  // ── Self-service clock-in / clock-out ──────────────────────────────────────

  private async scheduleFor(userId: string): Promise<ShiftSchedule> {
    const ws = await resolveWorkScheduleForUser(userId, new Date());
    if (ws && ws.timeZone) {
      return { timeZone: ws.timeZone, loginTime: ws.loginTime, logoutTime: ws.logoutTime, graceMinutes: ws.graceMinutes ?? 15 };
    }
    return DEFAULT_SCHEDULE;
  }

  /** Mark any of the user's prior open days (clocked in, never out) as half-day. */
  private async closeStaleDays(userId: string, todayMidnightUtc: Date) {
    await Attendance.updateMany(
      { user: userId, date: { $lt: todayMidnightUtc }, checkIn: { $ne: null }, checkOut: null, status: { $in: ["present", "late"] } },
      { $set: { status: "half_day" } }
    );
  }

  async getToday(userId: string) {
    const schedule = await this.scheduleFor(userId);
    const shift = resolveShift(schedule, new Date());
    await this.closeStaleDays(userId, shift.dateMidnightUtc);
    const attendance = await Attendance.findOne({ user: userId, date: shift.dateMidnightUtc }).lean();
    return {
      attendance,
      schedule,
      shift: {
        shiftStart: shift.shiftStart,
        shiftEnd: shift.shiftEnd,
        windowOpen: shift.windowOpen,
        lateThreshold: shift.lateThreshold,
        halfDayThreshold: shift.halfDayThreshold,
        serverNow: new Date(),
      },
    };
  }

  async listMine(userId: string, query: PaginationQuery & { dateFrom?: string; dateTo?: string }) {
    return this.list({ ...query, user: userId } as never);
  }

  async clockIn(userId: string) {
    const schedule = await this.scheduleFor(userId);
    const shift = resolveShift(schedule, new Date());
    const now = new Date();

    if (now.getTime() < shift.windowOpen.getTime()) {
      throw Object.assign(new Error("Clock-in is not open yet"), { statusCode: 400, code: "TOO_EARLY", windowOpen: shift.windowOpen });
    }

    await this.closeStaleDays(userId, shift.dateMidnightUtc);
    let att = await Attendance.findOne({ user: userId, date: shift.dateMidnightUtc });
    if (att && att.checkIn) {
      throw Object.assign(new Error("You have already clocked in today"), { statusCode: 409 });
    }

    const status = statusForClockIn(now, shift);
    // On-time within grace = not late; only count minutes when actually late.
    const lateMinutes = status === "present" ? 0 : Math.max(0, Math.round((now.getTime() - shift.shiftStart.getTime()) / 60000));

    if (!att) att = new Attendance({ organization: getOrgId(), user: userId, date: shift.dateMidnightUtc, timeZone: schedule.timeZone });
    att.timeZone = schedule.timeZone;
    att.status = status;
    att.lateMinutes = lateMinutes;
    att.sessions = [{ checkIn: now, checkOut: null }] as never;
    await att.save();
    return Attendance.findById(att._id).populate("user", "name email designation");
  }

  async clockOut(userId: string) {
    const now = new Date();

    // Close the latest still-open session (checked in, not yet out) rather than
    // only "today" — an overnight shift clocks out on the next calendar day.
    // Bounded to the last 2 days so a forgotten open day isn't closed here.
    const cutoff = new Date(now.getTime() - 2 * 86_400_000);
    const att = await Attendance.findOne({
      user: userId, checkIn: { $ne: null }, checkOut: null, date: { $gte: cutoff },
    }).sort({ date: -1 });
    if (!att) {
      throw Object.assign(new Error("You haven't clocked in, or already clocked out"), { statusCode: 400 });
    }

    if (att.sessions.length > 0) att.sessions[att.sessions.length - 1].checkOut = now;
    else att.sessions = [{ checkIn: att.checkIn!, checkOut: now }] as never;
    await att.save();
    return Attendance.findById(att._id).populate("user", "name email designation");
  }

  /**
   * Month attendance calendar for one employee or the whole org. Returns a
   * compact per-employee day-map (status + times), overlaying approved leave,
   * holidays, weekends (from the work schedule) and absent (past working days
   * with no record). One record per employee-day drives the calendar UI.
   */
  async calendar(month: string, employeeId?: string) {
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const year = start.getUTCFullYear();
    const monthIndex = start.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

    // Attendance stores a day as its local midnight in UTC, so the first day of
    // the month sits before this window and the first of the next month sits
    // inside it. Widen by a day at each end and let the local-day key below
    // decide what actually belongs to the month — that works whatever timezone
    // each person's schedule is in, without picking one for the whole query.
    const DAY = 86_400_000;
    const scanStart = new Date(start.getTime() - DAY);
    const scanEnd = new Date(end.getTime() + DAY);

    // Whose "today" it is depends on where the organization is, not on UTC.
    // This decides whether a blank past day is drawn as absent, so in the hours
    // either side of midnight the UTC date marks the wrong day.
    const orgTz = await this.orgTimeZone();
    const todayKey = todayInTz(orgTz);
    // Loaded once for the whole month rather than per employee — a calendar
    // walks everybody, and a query each would turn one page into dozens.
    const policyIndex = await leavePolicyIndex();

    const empFilter: Record<string, unknown> = { ...orgFilter(), user: { $ne: null } };
    if (employeeId) empFilter._id = employeeId;
    const employees = await Employee.find(empFilter)
      .select("name employeeCode designation user")
      .populate({ path: "user", select: "workSchedule", populate: { path: "workSchedule", select: "workDays timeZone" } })
      .sort({ name: 1 })
      .lean();

    const userIds = employees.map((e) => (e.user as { _id?: unknown } | null)?._id).filter(Boolean);

    const [att, monthLeaves, holidays, rosterMap, regs] = await Promise.all([
      Attendance.find({ user: { $in: userIds }, date: { $gte: scanStart, $lt: scanEnd } })
        .select("user date status workedMinutes checkIn checkOut lateMinutes note timeZone").lean(),
      LeaveRequest.find({ user: { $in: userIds }, status: "approved", startDate: { $lt: end }, endDate: { $gte: start } })
        .select("user startDate endDate type halfDay").lean(),
      Holiday.find({ ...orgFilter(), date: { $gte: start, $lt: end } }).select("date name").lean(),
      rosterWorkDaysByUser(userIds.map((id) => String(id)), start, end),
      // Corrections in flight or already applied. Shown on the day they concern
      // so a disputed day is visible as disputed, rather than looking settled.
      Regularization.find({ user: { $in: userIds }, status: { $in: ["pending", "approved"] }, date: { $gte: start, $lt: end } })
        .select("user date type status resultingStatus").lean(),
    ]);

    type DayLeave = { type: string; label: string; paid: boolean };
    type DayReg = { _id: unknown; type: string; status: string; resultingStatus?: string };
    type DayEntry = {
      status: string; workedMinutes?: number; checkIn?: Date | null; checkOut?: Date | null;
      lateMinutes?: number; note?: string; timeZone?: string | null;
      /** Approved leave covering this day, whatever the attendance says. */
      leave?: DayLeave;
      /** A correction raised for this day. */
      regularization?: DayReg;
    };
    const attByUser = new Map<string, Record<string, DayEntry>>();
    for (const a of att) {
      const uid = String(a.user);
      // Read the day back in the timezone it was written for. The record
      // carries its own; fall back to the org's for rows written before that
      // field existed. Days either side of the month simply never match a key.
      const key = localDayKey(a.date, a.timeZone || orgTz);
      if (!attByUser.has(uid)) attByUser.set(uid, {});
      attByUser.get(uid)![key] = {
        status: a.status as string, workedMinutes: a.workedMinutes ?? 0,
        checkIn: a.checkIn ?? null, checkOut: a.checkOut ?? null,
        lateMinutes: a.lateMinutes ?? 0, note: a.note ?? "", timeZone: a.timeZone ?? null,
      };
    }
    // Per user, the leave in force on each day — "wfh" paints the calendar
    // distinctly from actual leave (on_leave).
    const leaveDaysByUser = new Map<string, Map<string, string>>();
    for (const l of monthLeaves) {
      const uid = String(l.user);
      if (!leaveDaysByUser.has(uid)) leaveDaysByUser.set(uid, new Map());
      const map = leaveDaysByUser.get(uid)!;
      const from = new Date(Math.max(new Date(l.startDate).getTime(), start.getTime()));
      const to = new Date(Math.min(new Date(l.endDate).getTime(), end.getTime() - 1));
      for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) map.set(d.toISOString().slice(0, 10), l.type as string);
    }

    const regsByUser = new Map<string, Map<string, DayReg>>();
    for (const r of regs) {
      const uid = String(r.user);
      if (!regsByUser.has(uid)) regsByUser.set(uid, new Map());
      regsByUser.get(uid)!.set(new Date(r.date).toISOString().slice(0, 10), {
        _id: r._id, type: r.type as string, status: r.status as string,
        resultingStatus: (r as { resultingStatus?: string }).resultingStatus,
      });
    }
    const holidayMap = new Map<string, string>();
    for (const h of holidays) holidayMap.set(new Date(h.date).toISOString().slice(0, 10), h.name);

    const countable = new Set(["present", "late", "half_day", "absent", "on_leave", "holiday", "weekend", "wfh"]);
    const employeesOut = employees.map((e) => {
      const uid = (e.user as { _id?: unknown } | null)?._id ? String((e.user as { _id: unknown })._id) : "";
      // Static fallback for employees with no roster assignment covering a given day.
      const staticWorkDays: number[] = (e.user as { workSchedule?: { workDays?: number[] } } | null)?.workSchedule?.workDays ?? DEFAULT_WORK_DAYS;
      const rosterWindows = rosterMap.get(uid);
      const recs = attByUser.get(uid) ?? {};
      const leaveMap = leaveDaysByUser.get(uid) ?? new Map<string, string>();
      const regMap = regsByUser.get(uid) ?? new Map<string, DayReg>();
      // The schedule's own name for a leave type, so a custom one reads
      // properly instead of collapsing into a generic "On leave".
      const scheduleId = (e.user as { workSchedule?: { _id?: unknown } } | null)?.workSchedule?._id;
      const policies = policyIndex.for(scheduleId ? String(scheduleId) : null);
      const describeLeave = (type: string): DayLeave => {
        const p = policies.find((x) => x.type === type);
        return { type, label: p?.label ?? leaveLabel(type), paid: p ? p.paid : type !== "unpaid" };
      };

      const days: Record<string, DayEntry> = {};
      const summary: Record<string, number> = { present: 0, late: 0, half_day: 0, absent: 0, on_leave: 0, holiday: 0, weekend: 0, wfh: 0, avgWorkedMinutes: 0 };
      let workedTotal = 0, workedDays = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const key = `${month}-${String(d).padStart(2, "0")}`;
        const dayDate = new Date(Date.UTC(year, monthIndex, d));
        const dow = dayDate.getUTCDay();
        const workDays = workDaysForDate(rosterWindows, dayDate) ?? staticWorkDays;
        let entry: DayEntry | null;
        if (recs[key]) {
          entry = recs[key];
          if ((entry.workedMinutes ?? 0) > 0) { workedTotal += entry.workedMinutes!; workedDays++; }
        } else if (leaveMap.has(key)) entry = { status: leaveMap.get(key) === "wfh" ? "wfh" : "on_leave" };
        else if (holidayMap.has(key)) entry = { status: "holiday", note: holidayMap.get(key) };
        else if (!workDays.includes(dow)) entry = { status: "weekend" };
        else if (key < todayKey) entry = { status: "absent" };
        else entry = null;
        if (!entry) continue;
        // Attached whatever the day's status says, so leave stays visible even
        // when attendance was also recorded — previously a record hid it.
        if (leaveMap.has(key)) entry.leave = describeLeave(leaveMap.get(key)!);
        if (regMap.has(key)) entry.regularization = regMap.get(key);
        days[key] = entry;
        if (countable.has(entry.status)) summary[entry.status]++;
      }
      summary.avgWorkedMinutes = workedDays ? Math.round(workedTotal / workedDays) : 0;

      return {
        employee: { _id: e._id, name: e.name, employeeCode: e.employeeCode, designation: e.designation },
        days,
        summary,
      };
    });

    return { month, year, daysInMonth, employees: employeesOut };
  }
}
