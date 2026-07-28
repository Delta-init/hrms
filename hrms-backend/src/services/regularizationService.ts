import { Regularization } from "../models/Regularization.js";
import { Attendance } from "../models/Attendance.js";
import { User } from "../models/User.js";
import type { CreateRegularizationInput, UpdateRegularizationInput } from "../validations/regularizationValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { zonedTimeToUtc } from "../utils/schedule.js";

interface RegQuery extends PaginationQuery {
  user?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
}

const POP = [
  { path: "user", select: "name email designation" },
  { path: "reviewedBy", select: "name email" },
];

export class RegularizationService {
  async create(input: CreateRegularizationInput) {
    const user = await User.findById(input.user);
    if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });
    const reg = await Regularization.create({ ...input, organization: getOrgId(), status: input.status ?? "pending" });
    return Regularization.findById(reg._id).populate(POP);
  }

  async list(query: RegQuery) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.user) filter.user = query.user;
    if (query.status) filter.status = query.status;
    if (query.type) filter.type = query.type;
    if (query.dateFrom || query.dateTo) {
      const range: Record<string, Date> = {};
      if (query.dateFrom) range.$gte = new Date(query.dateFrom);
      if (query.dateTo) range.$lte = new Date(query.dateTo);
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
  private async applyToAttendance(reg: { user: unknown; date: Date; timeZone: string; requestedCheckIn?: Date | null; requestedCheckOut?: Date | null }) {
    // Normalize to the local-midnight-UTC convention self-service uses, and match
    // the whole day, so we update the existing record instead of creating a
    // duplicate. Stamp the org so the row is never invisible to scoped reports.
    const dayStr = new Date(reg.date).toISOString().slice(0, 10);
    const dayStart = zonedTimeToUtc(dayStr, "00:00", reg.timeZone);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    let att = await Attendance.findOne(scoped({ user: reg.user, date: { $gte: dayStart, $lt: dayEnd } }));
    if (!att) {
      att = new Attendance({ organization: getOrgId(), user: reg.user, date: dayStart, timeZone: reg.timeZone, status: "present" });
    }
    att.timeZone = reg.timeZone;
    if (reg.requestedCheckIn) {
      att.sessions = [{ checkIn: reg.requestedCheckIn, checkOut: reg.requestedCheckOut ?? null }] as never;
    } else if (reg.requestedCheckOut && att.sessions.length > 0) {
      att.sessions[att.sessions.length - 1].checkOut = reg.requestedCheckOut;
    }
    if (att.status === "absent") att.status = "present";
    await att.save();
  }

  async update(id: string, input: UpdateRegularizationInput, reviewerId: string) {
    const record = await Regularization.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Regularization not found"), { statusCode: 404 });

    if (input.date !== undefined) record.date = input.date;
    if (input.timeZone !== undefined) record.timeZone = input.timeZone;
    if (input.type !== undefined) record.type = input.type;
    if (input.requestedCheckIn !== undefined) record.requestedCheckIn = input.requestedCheckIn;
    if (input.requestedCheckOut !== undefined) record.requestedCheckOut = input.requestedCheckOut;
    if (input.reason !== undefined) record.reason = input.reason ?? undefined;
    if (input.reviewNote !== undefined) record.reviewNote = input.reviewNote ?? undefined;

    if (input.status !== undefined && input.status !== record.status) {
      record.status = input.status;
      if (input.status === "approved" || input.status === "rejected") {
        record.reviewedBy = reviewerId as never;
        record.reviewedAt = new Date();
      }
      if (input.status === "approved") {
        await this.applyToAttendance(record);
      }
    }

    await record.save();
    return Regularization.findById(id).populate(POP);
  }

  async remove(id: string) {
    const record = await Regularization.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Regularization not found"), { statusCode: 404 });
    return { message: "Regularization deleted successfully" };
  }
}
