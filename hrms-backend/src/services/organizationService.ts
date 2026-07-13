import { Organization } from "../models/Organization.js";
import type { CreateOrganizationInput, UpdateOrganizationInput } from "../validations/organizationValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";

/**
 * Organizations are the tenant registry — NOT scoped by org themselves.
 * Only the Super Admin manages them.
 */
export class OrganizationService {
  async create(input: CreateOrganizationInput) {
    const existing = await Organization.findOne({ code: input.code.trim().toUpperCase() });
    if (existing) throw Object.assign(new Error("Organization code already exists"), { statusCode: 409 });
    return Organization.create(input);
  }

  async list(query: PaginationQuery) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (query.search) {
      const rx = new RegExp(query.search, "i");
      filter.$or = [{ name: rx }, { code: rx }];
    }
    if (query.status) filter.status = query.status;

    const sortable = new Set(["name", "code", "status", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "name";
    const sortDir = query.sortOrder === "desc" ? -1 : 1;

    const [records, total] = await Promise.all([
      Organization.find(filter).sort({ [sortField]: sortDir }).skip(skip).limit(limit),
      Organization.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  /** Lightweight list for the switcher. */
  async listAll() {
    return Organization.find({ status: "active" }).select("name code logo").sort({ name: 1 });
  }

  async getById(id: string) {
    const record = await Organization.findById(id);
    if (!record) throw Object.assign(new Error("Organization not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateOrganizationInput) {
    const record = await Organization.findById(id);
    if (!record) throw Object.assign(new Error("Organization not found"), { statusCode: 404 });
    if (input.code && input.code.trim().toUpperCase() !== record.code) {
      const dupe = await Organization.findOne({ code: input.code.trim().toUpperCase(), _id: { $ne: id } });
      if (dupe) throw Object.assign(new Error("Organization code already exists"), { statusCode: 409 });
    }
    // Merge settings shallowly so partial updates don't wipe the rest.
    const { settings, ...rest } = input;
    Object.assign(record, rest);
    if (settings) record.settings = { ...record.settings, ...settings };
    await record.save();
    return record;
  }

  async remove(id: string) {
    const record = await Organization.findByIdAndDelete(id);
    if (!record) throw Object.assign(new Error("Organization not found"), { statusCode: 404 });
  }
}
