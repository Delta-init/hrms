import { Holiday } from "../models/Holiday.js";
import type { CreateHolidayInput, UpdateHolidayInput } from "../validations/holidayValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { searchRegex, parsePagination } from "../utils/query.js";

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
    const { page, limit, skip } = parsePagination(query, 100, 200);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.search) filter.name = searchRegex(query.search);
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
      // Whoever this belongs to. Written explicitly rather than left to fall
      // through: this whitelist pre-dates the field, and the two new fields
      // below were added here for the same reason — a field validated by the
      // schema and accepted by the controller still has to be named here, or
      // it is silently dropped before the save and the edit appears to work.
      ...(input.workMode !== undefined && { workMode: input.workMode || null }),
      ...(input.provisional !== undefined && { provisional: input.provisional }),
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
