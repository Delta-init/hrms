import mongoose from "mongoose";
import { Employee } from "../models/Employee.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Regularization } from "../models/Regularization.js";
import { Resignation } from "../models/Resignation.js";
import { orgFilter, getOrgId, scoped } from "../utils/orgContext.js";

/** Employees whose birthday (month + day of dob) falls on the given date. */
export async function birthdaysOn(date = new Date(), orgId?: string | null) {
  // Use UTC to match the aggregation's UTC $month / $dayOfMonth extraction.
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const match: Record<string, unknown> = { dob: { $ne: null } };
  if (orgId) match.organization = new mongoose.Types.ObjectId(orgId);
  return Employee.aggregate([
    { $match: match },
    { $addFields: { _m: { $month: "$dob" }, _d: { $dayOfMonth: "$dob" } } },
    { $match: { _m: month, _d: day } },
    {
      $lookup: { from: "departments", localField: "department", foreignField: "_id", as: "dept" },
    },
    {
      $project: {
        name: 1, employeeCode: 1, dob: 1, designation: 1, email: 1,
        department: { $ifNull: [{ $arrayElemAt: ["$dept.name", 0] }, null] },
      },
    },
    { $sort: { name: 1 } },
  ]);
}

/** Employees whose work anniversary (month + day of joiningDate) falls on the
 *  given date, excluding anyone who joined this exact calendar year (0 years
 *  isn't an anniversary yet). Includes `years` completed. */
export async function anniversariesOn(date = new Date(), orgId?: string | null) {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const match: Record<string, unknown> = { joiningDate: { $ne: null } };
  if (orgId) match.organization = new mongoose.Types.ObjectId(orgId);
  return Employee.aggregate([
    { $match: match },
    { $addFields: { _m: { $month: "$joiningDate" }, _d: { $dayOfMonth: "$joiningDate" }, _y: { $year: "$joiningDate" } } },
    { $match: { _m: month, _d: day, _y: { $lt: year } } },
    { $addFields: { years: { $subtract: [year, "$_y"] } } },
    {
      $lookup: { from: "departments", localField: "department", foreignField: "_id", as: "dept" },
    },
    {
      $project: {
        name: 1, employeeCode: 1, joiningDate: 1, designation: 1, email: 1, years: 1,
        department: { $ifNull: [{ $arrayElemAt: ["$dept.name", 0] }, null] },
      },
    },
    { $sort: { name: 1 } },
  ]);
}

interface ExpiringDoc {
  employee: { _id: unknown; name: string; employeeCode?: string; designation?: string };
  type: "passport" | "visa";
  label: string;
  expiryDate: Date;
  daysLeft: number;
  expired: boolean;
}

/**
 * Employees whose passport or visa expires within `withinDays` (already-expired
 * documents included, with a negative daysLeft). Sorted most-urgent first.
 */
export async function expiringDocuments(withinDays = 90, orgId?: string | null): Promise<ExpiringDoc[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() + withinDays * 86_400_000);
  const match: Record<string, unknown> = {
    status: { $ne: "terminated" },
    $or: [
      { "passport.expiryDate": { $ne: null, $lte: cutoff } },
      { "visa.expiryDate": { $ne: null, $lte: cutoff } },
    ],
  };
  if (orgId) match.organization = new mongoose.Types.ObjectId(orgId);

  const emps = await Employee.find(match)
    .select("name employeeCode designation passport visa")
    .lean<Array<{ _id: unknown; name: string; employeeCode?: string; designation?: string; passport?: { passportNumber?: string; expiryDate?: Date }; visa?: { type?: string; expiryDate?: Date } }>>();

  const items: ExpiringDoc[] = [];
  const push = (emp: (typeof emps)[number], type: "passport" | "visa", label: string, expiry?: Date | null) => {
    if (!expiry) return;
    const d = new Date(expiry);
    if (d > cutoff) return;
    const daysLeft = Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
    items.push({
      employee: { _id: emp._id, name: emp.name, employeeCode: emp.employeeCode, designation: emp.designation },
      type, label, expiryDate: d, daysLeft, expired: daysLeft < 0,
    });
  };
  for (const e of emps) {
    push(e, "passport", e.passport?.passportNumber ? `Passport ${e.passport.passportNumber}` : "Passport", e.passport?.expiryDate);
    push(e, "visa", e.visa?.type ? `Visa · ${e.visa.type}` : "Visa", e.visa?.expiryDate);
  }
  items.sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());
  return items;
}

interface OrgNode {
  _id: string;
  name: string;
  employeeCode?: string;
  designation?: string;
  department: string | null;
  children: OrgNode[];
}

export class DashboardService {
  /** Full list of expiring passports/visas within the window (default 90 days). */
  async documentExpiry(withinDays = 90) {
    return expiringDocuments(withinDays, getOrgId());
  }

  /**
   * Reporting-line org chart: a cycle-safe nested tree of employees. A manager
   * (reportingTo) may be an Employee or a login User; User references are mapped
   * back to the matching employee so the whole tree is employee-to-employee.
   */
  async orgChart() {
    const emps = await Employee.find(scoped({ status: { $ne: "terminated" } }))
      .select("name employeeCode designation department reportingTo reportingToKind user")
      .populate("department", "name")
      .lean<Array<{ _id: unknown; name: string; employeeCode?: string; designation?: string; department?: { name?: string } | null; reportingTo?: unknown; reportingToKind?: string; user?: unknown }>>();

    const idOf = (v: unknown) => (v ? String(v) : "");
    const byId = new Map(emps.map((e) => [idOf(e._id), e]));
    const userToEmp = new Map<string, string>();
    for (const e of emps) if (e.user) userToEmp.set(idOf(e.user), idOf(e._id));

    // Resolve each employee's parent employee id (or null).
    const parentOf = new Map<string, string | null>();
    for (const e of emps) {
      const id = idOf(e._id);
      let parentId: string | null = null;
      if (e.reportingTo) {
        parentId = e.reportingToKind === "User" ? userToEmp.get(idOf(e.reportingTo)) ?? null
          : byId.has(idOf(e.reportingTo)) ? idOf(e.reportingTo) : null;
      }
      parentOf.set(id, parentId && parentId !== id ? parentId : null);
    }

    // Would attaching `id` under `parentId` create a cycle?
    const wouldCycle = (id: string, parentId: string) => {
      let cur: string | null = parentId;
      const seen = new Set<string>();
      while (cur) {
        if (cur === id) return true;
        if (seen.has(cur)) return true;
        seen.add(cur);
        cur = parentOf.get(cur) ?? null;
      }
      return false;
    };

    const nodes = new Map<string, OrgNode>();
    for (const e of emps) nodes.set(idOf(e._id), {
      _id: idOf(e._id), name: e.name, employeeCode: e.employeeCode, designation: e.designation,
      department: e.department?.name ?? null, children: [],
    });

    const roots: OrgNode[] = [];
    for (const e of emps) {
      const id = idOf(e._id);
      const parentId = parentOf.get(id);
      if (parentId && nodes.has(parentId) && !wouldCycle(id, parentId)) nodes.get(parentId)!.children.push(nodes.get(id)!);
      else roots.push(nodes.get(id)!);
    }
    // Stable ordering by name at each level.
    const sortRec = (list: OrgNode[]) => { list.sort((a, b) => a.name.localeCompare(b.name)); list.forEach((n) => sortRec(n.children)); };
    sortRec(roots);
    return { roots, total: emps.length };
  }

  /** Aggregated HR snapshot: birthdays, who's out today, and pending approvals. */
  async summary() {
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setHours(23, 59, 59, 999);

    const org = orgFilter();
    const [birthdays, anniversaries, onLeaveToday, workingFromHomeToday, pendingLeaves, pendingRegs, pendingLeaveCount, pendingRegCount, servingNotice, servingNoticeCount, expiringDocs] = await Promise.all([
      birthdaysOn(now, getOrgId()),
      anniversariesOn(now, getOrgId()),
      // Working-from-home is not "away" — exclude it so this reflects who's
      // actually unavailable today.
      LeaveRequest.find({ ...org, status: "approved", type: { $ne: "wfh" }, startDate: { $lte: end }, endDate: { $gte: start } })
        .populate("user", "name email designation").sort({ startDate: 1 }).limit(50).lean(),
      LeaveRequest.find({ ...org, status: "approved", type: "wfh", startDate: { $lte: end }, endDate: { $gte: start } })
        .populate("user", "name email designation").sort({ startDate: 1 }).limit(50).lean(),
      LeaveRequest.find({ ...org, status: "pending" })
        .populate("user", "name email designation").sort({ createdAt: -1 }).limit(8).lean(),
      Regularization.find({ ...org, status: "pending" })
        .populate("user", "name email designation").sort({ createdAt: -1 }).limit(8).lean(),
      LeaveRequest.countDocuments({ ...org, status: "pending" }),
      Regularization.countDocuments({ ...org, status: "pending" }),
      Resignation.find({ ...org, status: "accepted" })
        .populate("employee", "name employeeCode designation").sort({ lastWorkingDay: 1 }).limit(8).lean(),
      Resignation.countDocuments({ ...org, status: "accepted" }),
      expiringDocuments(90, getOrgId()),
    ]);

    return {
      date: start.toISOString().slice(0, 10),
      birthdays,
      anniversaries,
      onLeaveToday,
      workingFromHomeToday,
      pendingLeaves,
      pendingRegularizations: pendingRegs,
      servingNotice,
      expiringDocuments: expiringDocs.slice(0, 8),
      counts: {
        birthdays: birthdays.length,
        anniversaries: anniversaries.length,
        onLeaveToday: onLeaveToday.length,
        workingFromHomeToday: workingFromHomeToday.length,
        pendingLeaves: pendingLeaveCount,
        pendingRegularizations: pendingRegCount,
        servingNotice: servingNoticeCount,
        expiringDocuments: expiringDocs.length,
      },
    };
  }

  /** Today's birthdays + work anniversaries — safe for every employee to see (self-service, no HR-sensitive data). */
  async wishesToday() {
    const now = new Date();
    const [birthdays, anniversaries] = await Promise.all([
      birthdaysOn(now, getOrgId()),
      anniversariesOn(now, getOrgId()),
    ]);
    return { birthdays, anniversaries };
  }
}
