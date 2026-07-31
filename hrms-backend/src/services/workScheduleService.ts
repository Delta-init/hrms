import { WorkSchedule } from "../models/WorkSchedule.js";
import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import { RosterAssignment } from "../models/RosterAssignment.js";
import type {
  CreateWorkScheduleInput, UpdateWorkScheduleInput,
} from "../validations/workScheduleValidation.js";
import type { CreateRosterAssignmentInput, UpdateRosterAssignmentInput } from "../validations/rosterValidation.js";
import type { PaginationQuery, IWorkSchedule } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";

const ROSTER_POP = [
  { path: "employee", select: "name employeeCode designation" },
  { path: "workSchedule", select: "name timeZone loginTime logoutTime workDays halfDays graceMinutes" },
  { path: "createdBy", select: "name" },
];

/** A date far enough out to stand in for "no end date" in range-overlap comparisons. */
const FAR_FUTURE = new Date("9999-12-31");

/** Whether an employee already has a roster assignment overlapping [from, to]. */
async function findOverlap(employeeId: string, from: Date, to: Date | null | undefined, excludeId?: string) {
  const filter: Record<string, unknown> = scoped({ employee: employeeId });
  if (excludeId) filter._id = { $ne: excludeId };
  filter.effectiveFrom = { $lte: to ?? FAR_FUTURE };
  filter.$or = [{ effectiveTo: null }, { effectiveTo: { $gte: from } }];
  return RosterAssignment.findOne(filter);
}

/**
 * The work schedule in force for a user on `date`: the roster assignment
 * whose date range covers it, falling back to their static `User.workSchedule`
 * for employees never given a roster assignment.
 */
export async function resolveWorkScheduleForUser(userId: string, date: Date): Promise<IWorkSchedule | null> {
  const assignment = await RosterAssignment.findOne({
    user: userId,
    effectiveFrom: { $lte: date },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: date } }],
  })
    .sort({ effectiveFrom: -1 })
    .populate<{ workSchedule: IWorkSchedule | null }>("workSchedule");
  if (assignment?.workSchedule) return assignment.workSchedule;

  const user = await User.findById(userId).populate<{ workSchedule: IWorkSchedule | null }>("workSchedule");
  return user?.workSchedule ?? null;
}

interface RosterWindow { from: Date; to: Date | null; workDays: number[] }

/** Every roster assignment (with its schedule's workDays) touching [start, end), grouped by user. */
export async function rosterWorkDaysByUser(userIds: string[], start: Date, end: Date): Promise<Map<string, RosterWindow[]>> {
  const assignments = await RosterAssignment.find({
    user: { $in: userIds },
    effectiveFrom: { $lt: end },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: start } }],
  })
    .populate<{ workSchedule: { workDays?: number[] } | null }>("workSchedule", "workDays")
    .lean();

  const map = new Map<string, RosterWindow[]>();
  for (const a of assignments) {
    const uid = String(a.user);
    if (!map.has(uid)) map.set(uid, []);
    map.get(uid)!.push({
      from: new Date(a.effectiveFrom),
      to: a.effectiveTo ? new Date(a.effectiveTo) : null,
      workDays: (a.workSchedule as { workDays?: number[] } | null)?.workDays ?? [1, 2, 3, 4, 5],
    });
  }
  for (const list of map.values()) list.sort((a, b) => b.from.getTime() - a.from.getTime());
  return map;
}

/** The workDays in force for a specific date from a user's pre-fetched roster windows (or null if none cover it). */
export function workDaysForDate(windows: RosterWindow[] | undefined, date: Date): number[] | null {
  if (!windows) return null;
  for (const w of windows) {
    if (w.from.getTime() <= date.getTime() && (!w.to || w.to.getTime() >= date.getTime())) return w.workDays;
  }
  return null;
}

export class WorkScheduleService {
  async create(input: CreateWorkScheduleInput) {
    const existing = await WorkSchedule.findOne(scoped({ name: input.name.trim() }));
    if (existing) throw Object.assign(new Error("A work schedule with this name already exists"), { statusCode: 409 });
    return WorkSchedule.create({ ...input, organization: getOrgId() });
  }

  async list(query: PaginationQuery) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { ...orgFilter() };
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
    const record = await WorkSchedule.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Work schedule not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateWorkScheduleInput) {
    const record = await WorkSchedule.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Work schedule not found"), { statusCode: 404 });

    if (input.name && input.name !== record.name) {
      const dupe = await WorkSchedule.findOne(scoped({ name: input.name.trim(), _id: { $ne: id } }));
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
    const rostered = await RosterAssignment.countDocuments(scoped({ workSchedule: id }));
    if (rostered > 0) {
      throw Object.assign(
        new Error(`Cannot delete: ${rostered} roster assignment(s) use this work schedule`),
        { statusCode: 400 }
      );
    }
    const record = await WorkSchedule.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Work schedule not found"), { statusCode: 404 });
    return { message: "Work schedule deleted successfully" };
  }

  // ── Shift roster assignments ─────────────────────────────────────────────
  async assignRoster(input: CreateRosterAssignmentInput, createdBy: string) {
    const employee = await Employee.findOne(scoped({ _id: input.employee }));
    if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
    const schedule = await WorkSchedule.findOne(scoped({ _id: input.workSchedule }));
    if (!schedule) throw Object.assign(new Error("Work schedule not found"), { statusCode: 404 });

    const clash = await findOverlap(input.employee, input.effectiveFrom, input.effectiveTo);
    if (clash) {
      throw Object.assign(new Error("This employee already has a roster assignment overlapping these dates"), { statusCode: 409 });
    }

    const doc = await RosterAssignment.create({
      organization: getOrgId(),
      employee: employee._id,
      user: employee.user ?? null,
      workSchedule: input.workSchedule,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      notes: input.notes,
      createdBy,
    });
    return RosterAssignment.findById(doc._id).populate(ROSTER_POP);
  }

  async listRosterAssignments(query: PaginationQuery & { employee?: string }) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.employee) filter.employee = query.employee;

    const [records, total] = await Promise.all([
      RosterAssignment.find(filter).populate(ROSTER_POP).sort({ effectiveFrom: -1 }).skip(skip).limit(limit),
      RosterAssignment.countDocuments(filter),
    ]);
    return { records, pagination: buildPagination(total, page, limit) };
  }

  async updateRosterAssignment(id: string, input: UpdateRosterAssignmentInput) {
    const record = await RosterAssignment.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Roster assignment not found"), { statusCode: 404 });

    if (input.workSchedule) {
      const schedule = await WorkSchedule.findOne(scoped({ _id: input.workSchedule }));
      if (!schedule) throw Object.assign(new Error("Work schedule not found"), { statusCode: 404 });
    }

    const from = input.effectiveFrom ?? record.effectiveFrom;
    const to = input.effectiveTo !== undefined ? input.effectiveTo : record.effectiveTo;
    const clash = await findOverlap(String(record.employee), from, to, id);
    if (clash) {
      throw Object.assign(new Error("This employee already has a roster assignment overlapping these dates"), { statusCode: 409 });
    }

    if (input.workSchedule !== undefined) record.workSchedule = input.workSchedule as never;
    if (input.effectiveFrom !== undefined) record.effectiveFrom = input.effectiveFrom;
    if (input.effectiveTo !== undefined) record.effectiveTo = input.effectiveTo;
    if (input.notes !== undefined) record.notes = input.notes;
    await record.save();
    return RosterAssignment.findById(id).populate(ROSTER_POP);
  }

  async removeRosterAssignment(id: string) {
    const record = await RosterAssignment.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Roster assignment not found"), { statusCode: 404 });
    return { message: "Roster assignment removed successfully" };
  }
}
