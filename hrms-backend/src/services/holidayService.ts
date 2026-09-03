import { Holiday } from "../models/Holiday.js";
import type { CreateHolidayInput, UpdateHolidayInput } from "../validations/holidayValidation.js";
import type { PaginationQuery, WorkMode } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { searchRegex, parsePagination } from "../utils/query.js";
import { holidayScope } from "../utils/holidayScope.js";

interface HolidayQuery extends PaginationQuery {
  type?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Who is asking, for the one rule that decides how much of the calendar they see.
 *
 * Somebody who can edit the calendar is administering it, and has to see every
 * group's holidays to do that — the Holidays tab is where a WFH day is told
 * apart from an office one in the first place. Everybody else is looking at
 * their own year, and a day that is not theirs showing up on their calendar or
 * in their list is not a preview of someone else's calendar, it is confusing:
 * it reads as a day off that then is not one.
 */
export interface HolidayViewer {
  canManage: boolean;
  workMode: WorkMode | null;
}

export class HolidayService {
  async create(input: CreateHolidayInput) {
    return Holiday.create({ ...input, organization: getOrgId() });
  }

  async list(query: HolidayQuery, viewer: HolidayViewer) {
    const { page, limit, skip } = parsePagination(query, 100, 200);

    const filter: Record<string, unknown> = { ...orgFilter() };
    // The scoping is skipped entirely for a manager rather than widened to
    // match — an `$or` that always matches is one refactor away from becoming
    // a filter that quietly stops filtering.
    if (!viewer.canManage) Object.assign(filter, holidayScope(viewer.workMode));
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

  /**
   * One holiday by id, refused if it is not this viewer's to see.
   *
   * The list above is what stops a non-manager from ever being handed an
   * out-of-scope id in the first place, but an id can be typed into a URL —
   * so this is checked independently rather than trusting that it always
   * arrived from an already-filtered list.
   */
  async getById(id: string, viewer: HolidayViewer) {
    const filter = viewer.canManage ? scoped({ _id: id }) : scoped({ _id: id, ...holidayScope(viewer.workMode) });
    const record = await Holiday.findOne(filter);
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
