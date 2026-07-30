import { Asset } from "../models/Asset.js";
import { Employee } from "../models/Employee.js";
import type {
  CreateAssetInput, UpdateAssetInput, IssueAssetInput, ReturnAssetInput,
} from "../validations/assetValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";

interface AssetQuery extends PaginationQuery {
  status?: string;
  category?: string;
  assignedTo?: string;
}

const POP = [
  { path: "assignedTo", select: "name employeeCode designation" },
  { path: "history.employee", select: "name employeeCode" },
];

export class AssetService {
  async create(input: CreateAssetInput, createdBy: string) {
    const existing = await Asset.findOne(scoped({ assetTag: input.assetTag }));
    if (existing) throw Object.assign(new Error("An asset with this tag already exists"), { statusCode: 409 });
    const doc = await Asset.create({
      organization: getOrgId(),
      ...input,
      status: "available",
      createdBy,
    });
    return Asset.findById(doc._id).populate(POP);
  }

  async list(query: AssetQuery) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "20", 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.status) filter.status = query.status;
    if (query.category) filter.category = query.category;
    if (query.assignedTo) filter.assignedTo = query.assignedTo;
    if (query.search) {
      filter.$or = [
        { name: { $regex: query.search, $options: "i" } },
        { assetTag: { $regex: query.search, $options: "i" } },
        { serialNumber: { $regex: query.search, $options: "i" } },
      ];
    }

    const sortable = new Set(["name", "assetTag", "category", "status", "purchaseDate", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "createdAt";
    const sortDir = query.sortOrder === "asc" ? 1 : -1;

    const [records, total] = await Promise.all([
      Asset.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit),
      Asset.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async getById(id: string) {
    const record = await Asset.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateAssetInput) {
    const record = await Asset.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });
    if (input.assetTag && input.assetTag !== record.assetTag) {
      const clash = await Asset.findOne(scoped({ assetTag: input.assetTag, _id: { $ne: id } }));
      if (clash) throw Object.assign(new Error("An asset with this tag already exists"), { statusCode: 409 });
    }
    Object.assign(record, input);
    await record.save();
    return Asset.findById(id).populate(POP);
  }

  async remove(id: string) {
    const record = await Asset.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });
    if (record.status === "assigned")
      throw Object.assign(new Error("This asset is currently assigned; return it before deleting"), { statusCode: 400 });
    await Asset.deleteOne({ _id: record._id });
    return { message: "Asset deleted successfully" };
  }

  /** Issue an available asset to an employee. */
  async issue(id: string, input: IssueAssetInput, actorId: string) {
    const record = await Asset.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });
    if (record.status !== "available")
      throw Object.assign(new Error(`This asset is ${record.status} and cannot be issued`), { statusCode: 400 });
    const employee = await Employee.findOne(scoped({ _id: input.employee }));
    if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });

    const now = new Date();
    record.assignedTo = employee._id as never;
    record.assignedDate = now;
    record.status = "assigned";
    if (input.condition) record.condition = input.condition;
    record.history.push({
      action: "issued", employee: employee._id as never, date: now,
      condition: input.condition ?? record.condition, notes: input.notes, by: actorId as never,
    });
    await record.save();
    return Asset.findById(id).populate(POP);
  }

  /** Return a currently-assigned asset, optionally routing it to maintenance. */
  async returnAsset(id: string, input: ReturnAssetInput, actorId: string) {
    const record = await Asset.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });
    if (record.status !== "assigned")
      throw Object.assign(new Error("This asset is not currently assigned"), { statusCode: 400 });

    const now = new Date();
    const returnedFrom = record.assignedTo;
    record.assignedTo = null;
    record.assignedDate = null;
    record.condition = input.condition;
    record.status = input.sendToMaintenance || input.condition === "damaged" ? "maintenance" : "available";
    record.history.push({
      action: "returned", employee: returnedFrom as never, date: now,
      condition: input.condition, notes: input.notes, by: actorId as never,
    });
    if (record.status === "maintenance") {
      record.history.push({ action: "sent_to_maintenance", date: now, condition: input.condition, by: actorId as never });
    }
    await record.save();
    return Asset.findById(id).populate(POP);
  }

  /** Bring a maintenance asset back into the available pool. */
  async markAvailable(id: string, actorId: string) {
    const record = await Asset.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });
    if (record.status !== "maintenance")
      throw Object.assign(new Error("Only assets in maintenance can be marked available"), { statusCode: 400 });
    record.status = "available";
    record.history.push({ action: "returned", date: new Date(), condition: record.condition, notes: "Maintenance complete", by: actorId as never });
    await record.save();
    return Asset.findById(id).populate(POP);
  }

  /** Permanently retire an asset (no longer issuable). */
  async retire(id: string, actorId: string) {
    const record = await Asset.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });
    if (record.status === "assigned")
      throw Object.assign(new Error("Return this asset before retiring it"), { statusCode: 400 });
    record.status = "retired";
    record.history.push({ action: "retired", date: new Date(), by: actorId as never });
    await record.save();
    return Asset.findById(id).populate(POP);
  }
}
