import { Types } from "mongoose";
import { Asset } from "../models/Asset.js";
import { Employee } from "../models/Employee.js";
import { Department } from "../models/Department.js";
import type {
  CreateAssetInput, UpdateAssetInput, IssueAssetInput, ReturnAssetInput, HolderQuery,
} from "../validations/assetValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { searchRegex, parsePagination } from "../utils/query.js";

interface AssetQuery extends PaginationQuery {
  status?: string;
  category?: string;
  assignedTo?: string;
  /** Department id — what that department holds. */
  assignedDepartment?: string;
  /** "person" or "department": only what is held by that kind of holder. */
  holder?: string;
  /** Office or site the thing lives at, as the register spells it. */
  branch?: string;
  /** Employee id — things they were issued at some point but no longer hold. */
  previouslyAssignedTo?: string;
}

const POP = [
  { path: "assignedTo", select: "name employeeCode designation" },
  { path: "assignedDepartment", select: "name code" },
  { path: "history.employee", select: "name employeeCode" },
  { path: "history.department", select: "name code" },
];

/** People who can be handed something: anyone still on the books. */
const LEFT = ["terminated", "resigned"];

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

  /** Self-service — assets currently assigned to the caller. */
  async listMine(userId: string, query: AssetQuery) {
    const employee = await Employee.findOne(scoped({ user: userId })).select("_id");
    if (!employee) return { records: [], pagination: buildPagination(0, 1, 20) };
    return this.list({ ...query, assignedTo: String(employee._id) });
  }

  /**
   * The category and branch values this organisation actually uses.
   *
   * Both fields are open text, so the filter dropdowns cannot be built from a
   * constant without going stale the moment somebody adds a kind of thing
   * nobody had bought before. Asking the data is the only answer that stays
   * true, and it is two grouped counts over an indexed field.
   */
  async facets() {
    // An aggregation gets no schema casting, so the org id has to be a real
    // ObjectId here — handed a string, $match silently matches nothing and the
    // filters come back empty rather than erroring.
    const orgId = getOrgId();
    const match: Record<string, unknown> = orgId ? { organization: new Types.ObjectId(orgId) } : {};
    const [categories, branches, departments] = await Promise.all([
      Asset.aggregate([{ $match: match }, { $group: { _id: "$category", count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      Asset.aggregate([{ $match: { ...match, branch: { $nin: ["", null] } } }, { $group: { _id: "$branch", count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
      Asset.aggregate([{ $match: { ...match, assignedDepartment: { $ne: null } } }, { $group: { _id: "$assignedDepartment", count: { $sum: 1 } } }]),
    ]);
    // Only the departments that hold something, named — the filter offers what would match.
    const names = new Map(
      (await Department.find({ _id: { $in: departments.map((d) => d._id) } }).select("name").lean())
        .map((d) => [String(d._id), String(d.name ?? "")])
    );
    return {
      categories: categories.filter((c) => c._id).map((c) => ({ value: String(c._id), count: c.count })),
      branches: branches.map((b) => ({ value: String(b._id), count: b.count })),
      departments: departments
        .filter((d) => names.has(String(d._id)))
        .map((d) => ({ value: String(d._id), label: names.get(String(d._id))!, count: d.count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  }

  /**
   * Who an asset can be issued to, for the Issue dialog.
   *
   * Its own list rather than the employee directory, because issuing an asset is an Assets job: the Business
   * Administrator holds Assets but not Employees (2026-11-20 — "Lallu is not seeing other employees"), and the
   * directory's records carry far more than a name. This hands back only what picking somebody needs.
   */
  async holders(query: HolderQuery) {
    const rx = query.search ? searchRegex(query.search) : null;
    if (query.kind === "department") {
      const rows = await Department.find(scoped({ status: { $ne: "inactive" }, ...(rx ? { $or: [{ name: rx }, { code: rx }] } : {}) }))
        .select("name code").sort({ name: 1 }).limit(query.limit).lean();
      return rows.map((d) => ({ _id: String(d._id), name: String(d.name ?? ""), sub: d.code ? String(d.code) : "" }));
    }
    const rows = await Employee.find(scoped({ status: { $nin: LEFT }, ...(rx ? { $or: [{ name: rx }, { employeeCode: rx }] } : {}) }))
      .select("name employeeCode department").populate("department", "name").sort({ name: 1 }).limit(query.limit).lean();
    return rows.map((e) => {
      const dept = e.department && typeof e.department === "object" && "name" in e.department ? String((e.department as { name?: string }).name ?? "") : "";
      return { _id: String(e._id), name: String(e.name ?? ""), sub: [e.employeeCode, dept].filter(Boolean).join(" · ") };
    });
  }

  async list(query: AssetQuery) {
    const { page, limit, skip } = parsePagination(query, 20, 200);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.status) filter.status = query.status;
    if (query.category) filter.category = query.category;
    if (query.assignedTo) filter.assignedTo = query.assignedTo;
    if (query.assignedDepartment) filter.assignedDepartment = query.assignedDepartment;
    if (query.holder === "person") filter.assignedTo = filter.assignedTo ?? { $ne: null };
    if (query.holder === "department") filter.assignedDepartment = filter.assignedDepartment ?? { $ne: null };
    if (query.branch) filter.branch = query.branch;

    /**
     * What somebody used to hold.
     *
     * Returning an asset clears `assignedTo`, so the record of who had it
     * survives only in its history. Matching an `issued` entry naming them, and
     * excluding anything they still hold, is what separates "used to have this"
     * from "has this now" — the two answers a leaver's checklist needs side by
     * side.
     *
     * `$ne` also covers assets now assigned to nobody, which is exactly what a
     * returned one looks like.
     */
    if (query.previouslyAssignedTo) {
      filter.history = { $elemMatch: { employee: query.previouslyAssignedTo, action: "issued" } };
      filter.assignedTo = { $ne: query.previouslyAssignedTo };
    }
    if (query.search) {
      // A department's name finds what it holds — "Accounts" should bring up the Accounts cabin's things.
      const depts = await Department.find(scoped({ name: searchRegex(query.search) })).select("_id").limit(20).lean();
      filter.$or = [
        { name: searchRegex(query.search) },
        { assetTag: searchRegex(query.search) },
        { serialNumber: searchRegex(query.search) },
        // The register's own words about a thing — the location it sits in, and
        // for anything imported, the name the sheet gave as its holder. Both are
        // what somebody actually types when hunting for an asset by hand.
        { location: searchRegex(query.search) },
        { notes: searchRegex(query.search) },
        ...(depts.length ? [{ assignedDepartment: { $in: depts.map((d) => d._id) } }] : []),
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

  /** Issue an available asset to a person or to a department. */
  async issue(id: string, input: IssueAssetInput, actorId: string) {
    const record = await Asset.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });
    if (record.status !== "available")
      throw Object.assign(new Error(`This asset is ${record.status} and cannot be issued`), { statusCode: 400 });

    let employeeId: unknown = null;
    let departmentId: unknown = null;
    if (input.department) {
      const department = await Department.findOne(scoped({ _id: input.department, status: { $ne: "inactive" } })).select("_id");
      if (!department) throw Object.assign(new Error("Department not found"), { statusCode: 404 });
      departmentId = department._id;
    } else {
      const employee = await Employee.findOne(scoped({ _id: input.employee })).select("_id status");
      if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
      if (LEFT.includes(String(employee.status))) throw Object.assign(new Error("They have left — choose someone still here"), { statusCode: 400 });
      employeeId = employee._id;
    }

    const now = new Date();
    record.assignedTo = employeeId as never;
    record.assignedDepartment = departmentId as never;
    record.assignedDate = now;
    record.status = "assigned";
    if (input.condition) record.condition = input.condition;
    record.history.push({
      action: "issued", employee: employeeId as never, department: departmentId as never, date: now,
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
    const returnedFrom = record.assignedTo ?? null;
    const returnedFromDepartment = record.assignedDepartment ?? null;
    record.assignedTo = null;
    record.assignedDepartment = null;
    record.assignedDate = null;
    record.condition = input.condition;
    record.status = input.sendToMaintenance || input.condition === "damaged" ? "maintenance" : "available";
    record.history.push({
      action: "returned", employee: returnedFrom as never, department: returnedFromDepartment as never, date: now,
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
