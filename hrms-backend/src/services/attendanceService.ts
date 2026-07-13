import { Attendance } from "../models/Attendance.js";
import { User } from "../models/User.js";
import type { CreateAttendanceInput, UpdateAttendanceInput } from "../validations/attendanceValidation.js";
import type { PaginationQuery, IWorkSchedule } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { resolveShift, statusForClockIn, DEFAULT_SCHEDULE, type ShiftSchedule } from "../utils/schedule.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";

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
    const user = await User.findById(input.user);
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

  async list(query: AttendanceQuery) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.user) filter.user = query.user;
    if (query.status) filter.status = query.status;
    if (query.dateFrom || query.dateTo) {
      const range: Record<string, Date> = {};
      if (query.dateFrom) range.$gte = new Date(query.dateFrom);
      if (query.dateTo) range.$lte = new Date(query.dateTo);
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
    const user = await User.findById(userId).populate("workSchedule");
    const ws = user?.workSchedule as IWorkSchedule | null | undefined;
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
    const lateMinutes = Math.max(0, Math.round((now.getTime() - shift.shiftStart.getTime()) / 60000));

    if (!att) att = new Attendance({ organization: getOrgId(), user: userId, date: shift.dateMidnightUtc, timeZone: schedule.timeZone });
    att.timeZone = schedule.timeZone;
    att.status = status;
    att.lateMinutes = lateMinutes;
    att.sessions = [{ checkIn: now, checkOut: null }] as never;
    await att.save();
    return Attendance.findById(att._id).populate("user", "name email designation");
  }

  async clockOut(userId: string) {
    const schedule = await this.scheduleFor(userId);
    const shift = resolveShift(schedule, new Date());
    const now = new Date();

    const att = await Attendance.findOne({ user: userId, date: shift.dateMidnightUtc });
    if (!att || !att.checkIn) {
      throw Object.assign(new Error("You haven't clocked in today"), { statusCode: 400 });
    }
    if (att.checkOut) {
      throw Object.assign(new Error("You have already clocked out today"), { statusCode: 409 });
    }

    if (att.sessions.length > 0) att.sessions[att.sessions.length - 1].checkOut = now;
    else att.sessions = [{ checkIn: att.checkIn!, checkOut: now }] as never;
    await att.save();
    return Attendance.findById(att._id).populate("user", "name email designation");
  }
}
