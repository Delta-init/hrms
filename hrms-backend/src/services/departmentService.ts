import { Department } from "../models/Department.js";
import { Employee } from "../models/Employee.js";
import { Attendance } from "../models/Attendance.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Organization } from "../models/Organization.js";
import type { CreateDepartmentInput, UpdateDepartmentInput } from "../validations/departmentValidation.js";
import type { PaginationQuery } from "../types/index.js";
import { buildPagination } from "../utils/response.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import { searchRegex, parsePagination } from "../utils/query.js";
import { localDayKey, DEFAULT_SCHEDULE } from "../utils/schedule.js";
import { departmentsHeadedBy } from "./departmentHeadService.js";

const POP = [
  { path: "leader", select: "name email employeeCode" },
  { path: "members.ref", select: "name email employeeCode" },
];

export class DepartmentService {
  /** Resolve a mixed Employee/User roster to the employee ids behind it. */
  private async resolveToEmployeeIds(refs: { kind?: string; ref: unknown }[]): Promise<string[]> {
    const employeeIds: string[] = [];
    const userIds: string[] = [];
    for (const { kind, ref } of refs) {
      if (!ref) continue;
      (kind === "User" ? userIds : employeeIds).push(String(ref));
    }
    if (userIds.length) {
      const linked = await Employee.find(scoped({ user: { $in: userIds } })).select("_id").lean();
      employeeIds.push(...linked.map((e) => String(e._id)));
    }
    return [...new Set(employeeIds)];
  }

  /**
   * Keep `Employee.department` and the reporting line in step with a
   * department's leader + members.
   *
   * The two were previously independent: adding someone here recorded them on
   * the Department, but their own record still said they belonged nowhere — so
   * the roster and the employee-count (which is derived from
   * `Employee.department`) disagreed. This makes the department roster the
   * source of truth in both directions, and joining a team now also points the
   * member at that team's leader as their manager.
   *
   * A member may be recorded as a login User rather than an Employee; those are
   * resolved through `Employee.user` so the same human is assigned either way.
   */
  private async syncEmployeeDepartments(
    departmentId: unknown,
    leader: unknown,
    leaderKind: string | undefined,
    members: { kind: string; ref: unknown }[]
  ) {
    const leaderEmpIds = await this.resolveToEmployeeIds([{ kind: leaderKind, ref: leader }]);
    const memberEmpIds = await this.resolveToEmployeeIds(members ?? []);
    const assigned = [...new Set([...leaderEmpIds, ...memberEmpIds])];

    await Promise.all([
      assigned.length
        ? Employee.updateMany(scoped({ _id: { $in: assigned } }), { $set: { department: departmentId } })
        : Promise.resolve(),
      // Anyone previously in this department but no longer on the roster is
      // released, so removing a member actually takes effect on their record.
      Employee.updateMany(
        scoped({ department: departmentId, _id: { $nin: assigned } }),
        { $set: { department: null } }
      ),
    ]);

    await this.syncReportingLine(departmentId, leader, leaderKind, leaderEmpIds, memberEmpIds);
  }

  /**
   * Point every member of a department at its team leader.
   *
   * Fills blanks only. The org chart is the authority on reporting lines, so
   * joining a team gives a manager to someone who has none — it never re-parents
   * or releases anyone the chart has already placed. The leader is skipped so
   * nobody reports to themselves, and an assignment that would close a loop is
   * skipped rather than written.
   */
  private async syncReportingLine(
    departmentId: unknown,
    leader: unknown,
    leaderKind: string | undefined,
    leaderEmpIds: string[],
    memberEmpIds: string[]
  ) {
    // Clearing the leader no longer clears the team's managers: the org chart
    // is the authority on reporting lines, so a line set there must survive a
    // department being edited.
    if (!leader) return;

    const leaderSet = new Set(leaderEmpIds);
    const candidates = memberEmpIds.filter((id) => !leaderSet.has(id));

    // Walk the leader's own reporting chain once; anyone on it can't be given
    // this leader as a manager without creating a loop.
    const ancestors = new Set<string>();
    let cursor: string | null = leaderEmpIds[0] ?? null;
    while (cursor && !ancestors.has(cursor)) {
      ancestors.add(cursor);
      const node: { reportingTo?: unknown; reportingToKind?: string } | null =
        await Employee.findById(cursor).select("reportingTo reportingToKind").lean();
      if (!node?.reportingTo) break;
      const [next] = await this.resolveToEmployeeIds([{ kind: node.reportingToKind, ref: node.reportingTo }]);
      cursor = next ?? null;
    }

    const safe = candidates.filter((id) => !ancestors.has(id));
    if (!safe.length) return;

    // Fill blanks only. The org chart owns reporting lines, so a member who
    // already has a manager keeps them — joining a team suggests a manager for
    // someone who has none, it doesn't re-parent people the chart has placed.
    await Employee.updateMany(
      scoped({ _id: { $in: safe }, $or: [{ reportingTo: null }, { reportingTo: { $exists: false } }] }),
      { $set: { reportingTo: leader, reportingToKind: leaderKind ?? "Employee" } }
    );
  }

  async create(input: CreateDepartmentInput) {
    const existing = await Department.findOne(scoped({ name: input.name.trim() }));
    if (existing) throw Object.assign(new Error("A department with this name already exists"), { statusCode: 409 });
    const dep = await Department.create({
      ...input,
      organization: getOrgId(),
      leader: input.leader || null,
      leaderKind: input.leaderKind ?? "Employee",
      members: input.members ?? [],
    });
    await this.syncEmployeeDepartments(dep._id, dep.leader, dep.leaderKind, dep.members ?? []);
    return Department.findById(dep._id).populate(POP);
  }

  async list(query: PaginationQuery) {
    const { page, limit, skip } = parsePagination(query, 50, 200);

    const filter: Record<string, unknown> = { ...orgFilter() };
    if (query.search) filter.name = searchRegex(query.search);
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
    return Department.find(scoped({ status: "active" })).select("name code").sort({ name: 1 }).lean();
  }

  /**
   * The department(s) this login heads. Empty for almost everybody.
   *
   * Self-service and permission-free on purpose, the same shape as the
   * approvals summary: it answers rather than refusing, so the sidebar can ask
   * it on every page load without generating a 403 for the other hundred
   * people who head nothing. It is also what turns a bare department id into
   * something worth linking to — a head with no base `departments` permission
   * still needs to know their own department's id to reach its page at all.
   */
  async mine(userId: string) {
    const ids = await departmentsHeadedBy(userId);
    if (!ids.length) return [];
    return Department.find(scoped({ _id: { $in: ids } })).select("name code").sort({ name: 1 }).lean();
  }

  async getById(id: string) {
    const record = await Department.findOne(scoped({ _id: id })).populate(POP);
    if (!record) throw Object.assign(new Error("Department not found"), { statusCode: 404 });
    return record;
  }

  async update(id: string, input: UpdateDepartmentInput) {
    const record = await Department.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Department not found"), { statusCode: 404 });

    if (input.name && input.name !== record.name) {
      const dupe = await Department.findOne(scoped({ name: input.name.trim(), _id: { $ne: id } }));
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
    // Only re-sync when the roster itself changed — a rename or status edit
    // shouldn't reshuffle anyone's department.
    if (input.leader !== undefined || input.members !== undefined) {
      await this.syncEmployeeDepartments(record._id, record.leader, record.leaderKind, record.members ?? []);
    }
    return Department.findById(id).populate(POP);
  }

  /** Full report for a department: members with leave counts + monthly attendance calendars. */
  async report(id: string, month: string) {
    const dept = await Department.findOne(scoped({ _id: id })).populate("leader", "name employeeCode email");
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

    // Attendance stores a day as its local midnight in UTC, so the month's
    // first day sits before this window. Widen by a day at each end and let the
    // local-day key decide what belongs to the month. See attendanceService.
    const DAY = 86_400_000;
    const org = await Organization.findById(getOrgId()).select("settings.timeZone").lean<{ settings?: { timeZone?: string } } | null>();
    const orgTz = org?.settings?.timeZone || DEFAULT_SCHEDULE.timeZone;

    const [att, leaves, monthLeaves] = await Promise.all([
      Attendance.find({ user: { $in: userIds }, date: { $gte: new Date(start.getTime() - DAY), $lt: new Date(end.getTime() + DAY) } })
        .select("user date status timeZone checkIn checkOut").lean(),
      LeaveRequest.find({ user: { $in: userIds }, status: "approved", startDate: { $lt: yearEnd }, endDate: { $gte: yearStart } }).select("user days").lean(),
      // Approved leaves that intersect the report month — used to paint the calendar.
      LeaveRequest.find({ user: { $in: userIds }, status: "approved", startDate: { $lt: end }, endDate: { $gte: start } }).select("user startDate endDate type").lean(),
    ]);

    /**
     * A day's status, and the two clock times behind it.
     *
     * The calendar used to carry only the status — a colour and a label — which
     * answers "was this person here" but not "when". A department head or HR
     * looking at a late mark wants the actual time without opening the
     * Attendance page for that one person, so the punches ride along with the
     * status they produced.
     */
    interface DayEntry { status: string; checkIn: Date | null; checkOut: Date | null; timeZone: string }
    const attByUser = new Map<string, Record<string, DayEntry>>();
    for (const a of att) {
      const uid = String(a.user);
      const tz = a.timeZone || orgTz;
      const key = localDayKey(a.date, tz);
      if (!attByUser.has(uid)) attByUser.set(uid, {});
      attByUser.get(uid)![key] = {
        status: a.status as string,
        checkIn: (a as { checkIn?: Date | null }).checkIn ?? null,
        checkOut: (a as { checkOut?: Date | null }).checkOut ?? null,
        // Carried per day rather than assumed from the org: a WFH employee's
        // punch is in Asia/Kolkata regardless of which zone the org defaults
        // to, and printing it in the wrong one is worse than not printing a
        // time at all — it reads as a specific, wrong fact.
        timeZone: tz,
      };
    }
    const leaveByUser = new Map<string, number>();
    for (const l of leaves) {
      const uid = String(l.user);
      leaveByUser.set(uid, (leaveByUser.get(uid) ?? 0) + (l.days || 0));
    }
    // Map each user to the leave type in force on each month day they are on
    // approved leave — "wfh" paints the calendar distinctly from actual leave.
    const leaveDaysByUser = new Map<string, Map<string, string>>();
    for (const l of monthLeaves) {
      const uid = String(l.user);
      if (!leaveDaysByUser.has(uid)) leaveDaysByUser.set(uid, new Map());
      const map = leaveDaysByUser.get(uid)!;
      const from = new Date(Math.max(new Date(l.startDate).getTime(), start.getTime()));
      const to = new Date(Math.min(new Date(l.endDate).getTime(), end.getTime() - 1));
      for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
        map.set(d.toISOString().slice(0, 10), l.type as string);
      }
    }

    const countKeys = ["present", "late", "half_day", "absent", "on_leave", "wfh"] as const;
    const members = employees.map((e) => {
      const uid = e.user ? String(e.user) : null;
      // Start from attendance, then paint approved-leave days that have no
      // attendance record (an actual attendance status always wins). A leave
      // day has no punch to show, so both times stay null — the frontend
      // already only prints a time when one is there.
      const calendar: Record<string, DayEntry> = uid ? { ...(attByUser.get(uid) ?? {}) } : {};
      if (uid) {
        for (const [key, type] of leaveDaysByUser.get(uid) ?? []) {
          if (!calendar[key]) calendar[key] = { status: type === "wfh" ? "wfh" : "on_leave", checkIn: null, checkOut: null, timeZone: orgTz };
        }
      }
      const summary: Record<string, number> = { present: 0, late: 0, half_day: 0, absent: 0, on_leave: 0, wfh: 0 };
      for (const { status: st } of Object.values(calendar)) {
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
    const record = await Department.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Department not found"), { statusCode: 404 });
    return { message: "Department deleted successfully" };
  }
}
