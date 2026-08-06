import { Announcement } from "../models/Announcement.js";
import type { CreateAnnouncementInput, UpdateAnnouncementInput } from "../validations/announcementValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { searchRegex, parsePagination } from "../utils/query.js";

interface AnnouncementQuery extends PaginationQuery {
  category?: string;
}

const POP = [{ path: "createdBy", select: "name" }];

export class AnnouncementService {
  async create(input: CreateAnnouncementInput, createdBy: string) {
    const doc = await Announcement.create({ ...input, organization: getOrgId(), createdBy });
    return Announcement.findById(doc._id).populate(POP);
  }

  /** Pinned first, then most recent. */
  async list(query: AnnouncementQuery) {
    const { page, limit, skip } = parsePagination(query, 20, 100);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.search) filter.title = searchRegex(query.search);
    if (query.category) filter.category = query.category;

    const [records, total] = await Promise.all([
      Announcement.find(filter).populate(POP).sort({ pinned: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      Announcement.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await Announcement.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Announcement not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateAnnouncementInput) {
    const record = await Announcement.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Announcement not found"), { statusCode: 404 });
    Object.assign(record, {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.body !== undefined && { body: input.body }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.pinned !== undefined && { pinned: input.pinned }),
    });
    await record.save();
    return Announcement.findById(id).populate(POP);
  }

  async remove(id: string) {
    const record = await Announcement.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Announcement not found"), { statusCode: 404 });
    return { message: "Announcement deleted successfully" };
  }
}
