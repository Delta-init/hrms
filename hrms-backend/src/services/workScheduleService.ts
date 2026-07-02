import { WorkSchedule } from "../models/WorkSchedule.js";
import { User } from "../models/User.js";
import type { CreateWorkScheduleInput, UpdateWorkScheduleInput } from "../validations/workScheduleValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";

export class WorkScheduleService {
  async create(input: CreateWorkScheduleInput) {
    const existing = await WorkSchedule.findOne({ name: input.name.trim() });
    if (existing) throw Object.assign(new Error("A work schedule with this name already exists"), { statusCode: 409 });
    return WorkSchedule.create(input);
  }

  async list(query: PaginationQuery) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (query.search) filter.name = new RegExp(query.search, "i");
    if (query.status) filter.status = query.status;

    const sortable = new Set(["name", "timeZone", "loginTime", "status", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "name";
    const sortDir = query.sortOrder === "desc" ? -1 : 1;

    const [records, total] = await Promise.all([
      WorkSchedule.find(filter).sort({ [sortField]: sortDir }).skip(skip).limit(limit).lean(),
      WorkSchedule.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async listSimple() {
    return WorkSchedule.find({ status: "active" })
      .select("name timeZone loginTime logoutTime workDays halfDays graceMinutes")
      .sort({ name: 1 })
      .lean();
  }

  async getById(id: string) {
    const record = await WorkSchedule.findById(id);
    if (!record) throw Object.assign(new Error("Work schedule not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateWorkScheduleInput) {
    const record = await WorkSchedule.findById(id);
    if (!record) throw Object.assign(new Error("Work schedule not found"), { statusCode: 404 });

    if (input.name && input.name !== record.name) {
      const dupe = await WorkSchedule.findOne({ name: input.name.trim(), _id: { $ne: id } });
      if (dupe) throw Object.assign(new Error("A work schedule with this name already exists"), { statusCode: 409 });
    }

    Object.assign(record, {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description ?? undefined }),
      ...(input.timeZone !== undefined && { timeZone: input.timeZone }),
      ...(input.loginTime !== undefined && { loginTime: input.loginTime }),
      ...(input.logoutTime !== undefined && { logoutTime: input.logoutTime }),
      ...(input.workDays !== undefined && { workDays: input.workDays }),
      ...(input.halfDays !== undefined && { halfDays: input.halfDays }),
      ...(input.graceMinutes !== undefined && { graceMinutes: input.graceMinutes }),
      ...(input.status !== undefined && { status: input.status }),
    });
    await record.save();
    return record;
  }

  async remove(id: string) {
    const assigned = await User.countDocuments({ workSchedule: id });
    if (assigned > 0) {
      throw Object.assign(
        new Error(`Cannot delete: ${assigned} user(s) are assigned to this work schedule`),
        { statusCode: 400 }
      );
    }
    const record = await WorkSchedule.findByIdAndDelete(id);
    if (!record) throw Object.assign(new Error("Work schedule not found"), { statusCode: 404 });
    return { message: "Work schedule deleted successfully" };
  }
}
