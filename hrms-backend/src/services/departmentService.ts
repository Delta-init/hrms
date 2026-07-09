import { Department } from "../models/Department.js";
import { Employee } from "../models/Employee.js";
import { Attendance } from "../models/Attendance.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import type { CreateDepartmentInput, UpdateDepartmentInput } from "../validations/departmentValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";

const POP = [
  { path: "leader", select: "name email employeeCode" },
  { path: "members.ref", select: "name email employeeCode" },
];

export class DepartmentService {
  async create(input: CreateDepartmentInput) {
    const existing = await Department.findOne({ name: input.name.trim() });
    if (existing) throw Object.assign(new Error("A department with this name already exists"), { statusCode: 409 });
    const dep = await Department.create({
      ...input,
      leader: input.leader || null,
      leaderKind: input.leaderKind ?? "Employee",
      members: input.members ?? [],
    });
    return Department.findById(dep._id).populate(POP);
  }

  async list(query: PaginationQuery) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10)));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (query.search) filter.name = new RegExp(query.search, "i");
    if (query.status) filter.status = query.status;

    const sortable = new Set(["name", "code", "status", "createdAt"]);
    const sortField = query.sortBy && sortable.has(query.sortBy) ? query.sortBy : "name";
    const sortDir = query.sortOrder === "desc" ? -1 : 1;

    const [records, total] = await Promise.all([
      Department.find(filter).populate(POP).sort({ [sortField]: sortDir }).skip(skip).limit(limit).lean(),
      Department.countDocuments(filter),
    ]);

    const withCounts = await Promise.all(
      records.map(async (d) => ({ ...d, employeeCount: await Employee.countDocuments({ department: d._id }) }))
    );
    return { records: withCounts, pagination: buildPagination(total, page, limit) };
  }

  async listSimple() {
    return Department.find({ status: "active" }).select("name code").sort({ name: 1 }).lean();
  }

  async getById(id: string) {
    const record = await Department.findById(id).populate(POP);
    if (!record) throw Object.assign(new Error("Department not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateDepartmentInput) {
    const record = await Department.findById(id);
    if (!record) throw Object.assign(new Error("Department not found"), { statusCode: 404 });

    if (input.name && input.name !== record.name) {
      const dupe = await Department.findOne({ name: input.name.trim(), _id: { $ne: id } });
      if (dupe) throw Object.assign(new Error("A department with this name already exists"), { statusCode: 409 });
    }

    if (input.name !== undefined) record.name = input.name;
    if (input.code !== undefined) record.code = input.code ?? undefined;
    if (input.description !== undefined) record.description = input.description ?? undefined;
    if (input.status !== undefined) record.status = input.status;
    if (input.leader !== undefined) {
      record.leader = (input.leader || null) as never;
      if (input.leader && input.leaderKind) record.leaderKind = input.leaderKind;
    }
    if (input.members !== undefined) record.members = input.members as never;

    await record.save();
    return Department.findById(id).populate(POP);
  }

  /** Full report for a department: members with leave counts + monthly attendance calendars. */
  async report(id: string, month: string) {
    const dept = await Department.findById(id).populate("leader", "name employeeCode email");
    if (!dept) throw Object.assign(new Error("Department not found"), { statusCode: 404 });

    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const year = start.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
    const daysInMonth = new Date(Date.UTC(year, start.getUTCMonth() + 1, 0)).getUTCDate();

    const employees = await Employee.find({ department: id })
      .select("name employeeCode designation user")
      .sort({ name: 1 })
      .lean();
    const userIds = employees.map((e) => e.user).filter(Boolean);

    const [att, leaves, monthLeaves] = await Promise.all([
      Attendance.find({ user: { $in: userIds }, date: { $gte: start, $lt: end } }).select("user date status").lean(),
      LeaveRequest.find({ user: { $in: userIds }, status: "approved", startDate: { $lt: yearEnd }, endDate: { $gte: yearStart } }).select("user days").lean(),
      // Approved leaves that intersect the report month — used to paint the calendar.
      LeaveRequest.find({ user: { $in: userIds }, status: "approved", startDate: { $lt: end }, endDate: { $gte: start } }).select("user startDate endDate").lean(),
    ]);

    const attByUser = new Map<string, Record<string, string>>();
    for (const a of att) {
      const uid = String(a.user);
      const key = new Date(a.date).toISOString().slice(0, 10);
      if (!attByUser.has(uid)) attByUser.set(uid, {});
      attByUser.get(uid)![key] = a.status as string;
    }
    const leaveByUser = new Map<string, number>();
    for (const l of leaves) {
      const uid = String(l.user);
      leaveByUser.set(uid, (leaveByUser.get(uid) ?? 0) + (l.days || 0));
    }
    // Map each user to the set of month days they are on approved leave.
    const leaveDaysByUser = new Map<string, Set<string>>();
    for (const l of monthLeaves) {
      const uid = String(l.user);
      if (!leaveDaysByUser.has(uid)) leaveDaysByUser.set(uid, new Set());
      const set = leaveDaysByUser.get(uid)!;
      const from = new Date(Math.max(new Date(l.startDate).getTime(), start.getTime()));
      const to = new Date(Math.min(new Date(l.endDate).getTime(), end.getTime() - 1));
      for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
        set.add(d.toISOString().slice(0, 10));
      }
    }

    const countKeys = ["present", "late", "half_day", "absent", "on_leave", "wfh"] as const;
    const members = employees.map((e) => {
      const uid = e.user ? String(e.user) : null;
      // Start from attendance, then paint approved-leave days that have no
      // attendance record (an actual attendance status always wins).
      const calendar: Record<string, string> = uid ? { ...(attByUser.get(uid) ?? {}) } : {};
      if (uid) {
        for (const key of leaveDaysByUser.get(uid) ?? []) {
          if (!calendar[key]) calendar[key] = "on_leave";
        }
      }
      const summary: Record<string, number> = { present: 0, late: 0, half_day: 0, absent: 0, on_leave: 0, wfh: 0 };
      for (const st of Object.values(calendar)) {
        if ((countKeys as readonly string[]).includes(st)) summary[st]++;
      }
      return {
        employee: { _id: e._id, name: e.name, employeeCode: e.employeeCode, designation: e.designation },
        hasUser: !!uid,
        leaveDays: uid ? leaveByUser.get(uid) ?? 0 : 0,
        summary,
        calendar,
      };
    });

    return {
      department: { _id: dept._id, name: dept.name, code: dept.code, leader: dept.leader, status: dept.status, memberCount: employees.length },
      month,
      year,
      daysInMonth,
      members,
    };
  }

  async remove(id: string) {
    const count = await Employee.countDocuments({ department: id });
    if (count > 0) {
      throw Object.assign(new Error(`Cannot delete: ${count} employee(s) belong to this department`), { statusCode: 400 });
    }
    const record = await Department.findByIdAndDelete(id);
    if (!record) throw Object.assign(new Error("Department not found"), { statusCode: 404 });
    return { message: "Department deleted successfully" };
  }
}
