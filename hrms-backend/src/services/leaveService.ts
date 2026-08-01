import { LeaveRequest } from "../models/LeaveRequest.js";
import { User } from "../models/User.js";
import { Holiday } from "../models/Holiday.js";
import type { CreateLeaveInput, UpdateLeaveInput } from "../validations/leaveValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { compOffBalanceFor } from "./compOffService.js";

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
    const user = await User.findOne(scoped({ _id: input.user })).populate("workSchedule", "workDays");
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

    if (input.type === "comp_off") {
      const balance = await compOffBalanceFor(input.user);
      if (days > balance) {
        throw Object.assign(
          new Error(`Insufficient comp-off balance (${balance} day${balance === 1 ? "" : "s"} available, ${days} requested)`),
          { statusCode: 400 }
        );
      }
    }

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
    });
    return LeaveRequest.findById(leave._id).populate("user", "name email designation");
  }

  async list(query: LeaveQuery) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10)));
    const skip = (page - 1) * limit;

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

  async update(id: string, input: UpdateLeaveInput, reviewerId: string) {
    const record = await LeaveRequest.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Leave request not found"), { statusCode: 404 });

    if (input.type !== undefined) record.type = input.type;
    if (input.startDate !== undefined) record.startDate = input.startDate;
    if (input.endDate !== undefined) record.endDate = input.endDate;
    if (input.halfDay !== undefined) record.halfDay = input.halfDay;
    if (input.timeZone !== undefined) record.timeZone = input.timeZone;
    if (input.reason !== undefined) record.reason = input.reason ?? undefined;
    if (input.reviewNote !== undefined) record.reviewNote = input.reviewNote ?? undefined;

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

    // Status change = a review action.
    if (input.status !== undefined && input.status !== record.status) {
      record.status = input.status;
      if (input.status === "approved" || input.status === "rejected") {
        record.reviewedBy = reviewerId as never;
        record.reviewedAt = new Date();
      }
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
}
