import { Procurement } from "../models/Procurement.js";
import type { CreateProcurementInput, UpdateProcurementInput } from "../validations/procurementValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { searchRegex, parsePagination } from "../utils/query.js";

const POP = [
  { path: "department", select: "name code" },
  { path: "requestedBy", select: "name email" },
];

interface ProcurementQuery extends PaginationQuery {
  status?: string;
  category?: string;
  department?: string;
}

export class ProcurementService {
  async create(input: CreateProcurementInput, requestedBy: string) {
    const record = await Procurement.create({
      ...input,
      department: input.department || null,
      organization: getOrgId(),
      requestedBy,
    });
    return Procurement.findById(record._id).populate(POP);
  }

  async list(query: ProcurementQuery) {
    const { page, limit, skip } = parsePagination(query, 20, 200);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.search) filter.item = searchRegex(query.search);
    // Comma-separated so one request can ask for everything still outstanding,
    // which is the view somebody actually wants on opening the page.
    if (query.status) filter.status = query.status.includes(",") ? { $in: query.status.split(",") } : query.status;
    if (query.category) filter.category = query.category;
    if (query.department) filter.department = query.department;

    const sortable = new Set(["item", "quantity", "estimatedCost", "neededBy", "status", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "createdAt";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      Procurement.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit).lean(),
      Procurement.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await Procurement.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Procurement not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateProcurementInput) {
    const record = await Procurement.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Procurement not found"), { statusCode: 404 });

    // `department` is cleared with an explicit null rather than by omission,
    // so leaving it out of a partial edit keeps whatever is there.
    const patch: Record<string, unknown> = { ...input };
    if (input.department !== undefined) patch.department = input.department || null;

    await Procurement.updateOne({ _id: record._id }, { $set: patch });
    return Procurement.findById(record._id).populate(POP);
  }

  async remove(id: string) {
    const record = await Procurement.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Procurement not found"), { statusCode: 404 });
    await Procurement.deleteOne({ _id: record._id });
    return { message: "Procurement deleted successfully" };
  }
}
