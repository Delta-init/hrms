import { LeaveRequest } from "../models/LeaveRequest.js";
import { User } from "../models/User.js";
import type { CreateLeaveInput, UpdateLeaveInput } from "../validations/leaveValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";

interface LeaveQuery extends PaginationQuery {
  user?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Inclusive whole-day count between two dates; halfDay overrides to 0.5. */
function countDays(start: Date, end: Date, halfDay: boolean): number {
  if (halfDay) return 0.5;
  const ms = new Date(end).setHours(0, 0, 0, 0) - new Date(start).setHours(0, 0, 0, 0);
  return Math.floor(ms / 86400000) + 1;
}

export class LeaveService {
  async create(input: CreateLeaveInput) {
    const user = await User.findById(input.user);
    if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });

    if (input.endDate < input.startDate) {
      throw Object.assign(new Error("End date cannot be before start date"), { statusCode: 400 });
    }

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

    const leave = await LeaveRequest.create({
      user: input.user,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      halfDay: input.halfDay,
      days: countDays(input.startDate, input.endDate, input.halfDay),
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

    const filter: Record<string, unknown> = {};
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
    const record = await LeaveRequest.findById(id)
      .populate("user", "name email designation")
      .populate("reviewedBy", "name email");
    if (!record) throw Object.assign(new Error("Leave request not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateLeaveInput, reviewerId: string) {
    const record = await LeaveRequest.findById(id);
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
    record.days = countDays(record.startDate, record.endDate, record.halfDay);

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
    const record = await LeaveRequest.findByIdAndDelete(id);
    if (!record) throw Object.assign(new Error("Leave request not found"), { statusCode: 404 });
    return { message: "Leave request deleted successfully" };
  }
}
