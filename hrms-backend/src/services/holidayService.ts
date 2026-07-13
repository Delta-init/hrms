import { Holiday } from "../models/Holiday.js";
import type { CreateHolidayInput, UpdateHolidayInput } from "../validations/holidayValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";

interface HolidayQuery extends PaginationQuery {
  type?: string;
  dateFrom?: string;
  dateTo?: string;
}

export class HolidayService {
  async create(input: CreateHolidayInput) {
    return Holiday.create({ ...input, organization: getOrgId() });
  }

  async list(query: HolidayQuery) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "100", 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.search) filter.name = new RegExp(query.search, "i");
    if (query.type) filter.type = query.type;
    if (query.dateFrom || query.dateTo) {
      const range: Record<string, Date> = {};
      if (query.dateFrom) range.$gte = new Date(query.dateFrom);
      if (query.dateTo) range.$lte = new Date(query.dateTo);
      filter.date = range;
    }

    const [records, total] = await Promise.all([
      Holiday.find(filter).sort({ date: 1 }).skip(skip).limit(limit).lean(),
      Holiday.countDocuments(filter),
    ]);

    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await Holiday.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Holiday not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateHolidayInput) {
    const record = await Holiday.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Holiday not found"), { statusCode: 404 });
    Object.assign(record, {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.date !== undefined && { date: input.date }),
      ...(input.timeZone !== undefined && { timeZone: input.timeZone }),
      ...(input.type !== undefined && { type: input.type }),
      ...(input.recurring !== undefined && { recurring: input.recurring }),
      ...(input.workSchedule !== undefined && { workSchedule: input.workSchedule || null }),
      ...(input.description !== undefined && { description: input.description ?? undefined }),
    });
    await record.save();
    return record;
  }

  async remove(id: string) {
    const record = await Holiday.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Holiday not found"), { statusCode: 404 });
    return { message: "Holiday deleted successfully" };
  }
}
