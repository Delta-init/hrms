import mongoose from "mongoose";
import { Employee } from "../models/Employee.js";
import { Card } from "../models/Card.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Regularization } from "../models/Regularization.js";
import { Resignation } from "../models/Resignation.js";
import { orgFilter, getOrgId, scoped } from "../utils/orgContext.js";
import { publicUrl } from "../config/r2.js";
import { confirmationsDue } from "./confirmationService.js";

/**
 * The month/day keys (month*100 + day) covered by a window starting today.
 *
 * Enumerated rather than compared as a range because the window wraps the year
 * end — 20 Dec + 30 days lands on 19 Jan, where "month/day between start and
 * end" is false for every date in between. Date.UTC normalises overflow, so
 * month ends and leap days need no special handling.
 */
function monthDayKeys(from: Date, withinDays: number): number[] {
  const keys: number[] = [];
  for (let i = 0; i <= withinDays; i++) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + i));
    keys.push((d.getUTCMonth() + 1) * 100 + d.getUTCDate());
  }
  return keys;
}

/** Whole days from today until the next occurrence of a month/day. */
function daysUntilNext(from: Date, month: number, day: number): number {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  for (let i = 0; i <= 366; i++) {
    const d = new Date(start + i * 86_400_000);
    if (d.getUTCMonth() + 1 === month && d.getUTCDate() === day) return i;
  }
  return 0;
}

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

interface UpcomingPerson {
  _id: unknown;
  name: string;
  employeeCode?: string;
  designation?: string;
  department?: string | null;
  date: Date;
  daysUntil: number;
  /** Completed years on the upcoming anniversary. Absent for birthdays. */
  years?: number;
}

/** Shared lookahead over a recurring month/day field (dob or joiningDate). */
async function upcomingByMonthDay(
  field: "dob" | "joiningDate",
  withinDays: number,
  orgId?: string | null,
  withYears = false
): Promise<UpcomingPerson[]> {
  const now = new Date();
  const keys = monthDayKeys(now, withinDays);

  const match: Record<string, unknown> = { [field]: { $ne: null }, status: { $ne: "terminated" } };
  if (orgId) match.organization = new mongoose.Types.ObjectId(orgId);

  const rows = await Employee.aggregate([
    { $match: match },
    { $addFields: { _m: { $month: `$${field}` }, _d: { $dayOfMonth: `$${field}` } } },
    { $addFields: { _key: { $add: [{ $multiply: ["$_m", 100] }, "$_d"] } } },
    { $match: { _key: { $in: keys } } },
    { $lookup: { from: "departments", localField: "department", foreignField: "_id", as: "dept" } },
    {
      $project: {
        name: 1, employeeCode: 1, designation: 1, email: 1, _m: 1, _d: 1,
        date: `$${field}`,
        department: { $ifNull: [{ $arrayElemAt: ["$dept.name", 0] }, null] },
      },
    },
  ]);

  const out: UpcomingPerson[] = rows.map((r) => {
    const daysUntil = daysUntilNext(now, r._m, r._d);
    const person: UpcomingPerson = {
      _id: r._id, name: r.name, employeeCode: r.employeeCode, designation: r.designation,
      department: r.department, date: r.date, daysUntil,
    };
    if (withYears) {
      // Years completed as at the upcoming occurrence, not as at today.
      const at = new Date(Date.now() + daysUntil * 86_400_000);
      person.years = at.getUTCFullYear() - new Date(r.date).getUTCFullYear();
    }
    return person;
  });

  // Anniversaries only count once a full year is up.
  const filtered = withYears ? out.filter((p) => (p.years ?? 0) >= 1) : out;
  filtered.sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));
  return filtered;
}

/** Birthdays falling within the next `withinDays` days (default a month). */
export async function upcomingBirthdays(withinDays = 30, orgId?: string | null) {
  return upcomingByMonthDay("dob", withinDays, orgId);
}

/** Work anniversaries falling within the next `withinDays` days (default a week). */
export async function upcomingAnniversaries(withinDays = 7, orgId?: string | null) {
  return upcomingByMonthDay("joiningDate", withinDays, orgId, true);
}

/** Employees who joined in the last `withinDays` days, most recent first. */
export async function recentJoiners(withinDays = 30, orgId?: string | null) {
  const since = new Date(Date.now() - withinDays * 86_400_000);
  const match: Record<string, unknown> = {
    joiningDate: { $ne: null, $gte: since, $lte: new Date() },
    status: { $ne: "terminated" },
  };
  if (orgId) match.organization = new mongoose.Types.ObjectId(orgId);
  return Employee.find(match)
    .select("name employeeCode designation joiningDate")
    .populate("department", "name")
    .sort({ joiningDate: -1 })
    .lean();
}

/** Employees who resigned in the last `withinDays` days, most recent first. */
export async function recentResignations(withinDays = 30, orgId?: string | null) {
  const since = new Date(Date.now() - withinDays * 86_400_000);
  const match: Record<string, unknown> = { resignationDate: { $gte: since, $lte: new Date() } };
  if (orgId) match.organization = new mongoose.Types.ObjectId(orgId);
  return Resignation.find(match)
    .select("employee resignationDate lastWorkingDay status")
    .populate("employee", "name employeeCode designation")
    .sort({ resignationDate: -1 })
    .lean();
}

export type ExpiringDocType = "passport" | "visa" | "labourCard" | "emiratesId" | "card";

interface ExpiringDoc {
  employee: { _id: unknown; name: string; employeeCode?: string; designation?: string };
  type: ExpiringDocType;
  label: string;
  expiryDate: Date;
  daysLeft: number;
  expired: boolean;
}

interface EmpDocs {
  _id: unknown;
  name: string;
  employeeCode?: string;
  designation?: string;
  user?: unknown;
  passport?: { passportNumber?: string; expiryDate?: Date };
  visa?: { type?: string; expiryDate?: Date };
  labourCard?: { cardNumber?: string; expiryDate?: Date };
  emiratesId?: { idNumber?: string; expiryDate?: Date };
}

/**
 * Everything with an expiry date that lapsing would cause a compliance or
 * access problem: passport, visa, labour card, Emirates ID and issued access
 * cards. Already-expired items are included with a negative daysLeft, so the
 * dashboard can show "overdue" rather than silently dropping them. Sorted
 * most-urgent first.
 */
export async function expiringDocuments(withinDays = 90, orgId?: string | null): Promise<ExpiringDoc[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() + withinDays * 86_400_000);
  const expiringBy = (path: string) => ({ [path]: { $ne: null, $lte: cutoff } });

  const match: Record<string, unknown> = {
    status: { $ne: "terminated" },
    $or: [
      expiringBy("passport.expiryDate"),
      expiringBy("visa.expiryDate"),
      expiringBy("labourCard.expiryDate"),
      expiringBy("emiratesId.expiryDate"),
    ],
  };
  const scope = orgId ? { organization: new mongoose.Types.ObjectId(orgId) } : {};
  Object.assign(match, scope);

  // Cards hang off the login account, so they are resolved back to the employee
  // separately rather than being part of the employee $or above.
  const [emps, cards] = await Promise.all([
    Employee.find(match)
      .select("name employeeCode designation passport visa labourCard emiratesId")
      .lean<EmpDocs[]>(),
    Card.find({ ...scope, expiryDate: { $ne: null, $lte: cutoff } })
      .select("cardNumber name client expiryDate")
      .lean<Array<{ cardNumber: string; name: string; client: unknown; expiryDate?: Date }>>(),
  ]);

  const items: ExpiringDoc[] = [];
  const push = (
    emp: { _id: unknown; name: string; employeeCode?: string; designation?: string },
    type: ExpiringDocType,
    label: string,
    expiry?: Date | null
  ) => {
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
    push(e, "labourCard", e.labourCard?.cardNumber ? `Labour card ${e.labourCard.cardNumber}` : "Labour card", e.labourCard?.expiryDate);
    push(e, "emiratesId", e.emiratesId?.idNumber ? `Emirates ID ${e.emiratesId.idNumber}` : "Emirates ID", e.emiratesId?.expiryDate);
  }

  if (cards.length) {
    const holders = await Employee.find({ ...scope, user: { $in: cards.map((c) => c.client) } })
      .select("name employeeCode designation user")
      .lean<EmpDocs[]>();
    const byUser = new Map(holders.map((h) => [String(h.user), h]));
    for (const c of cards) {
      // Fall back to the name printed on the card when no employee record is linked.
      const holder = byUser.get(String(c.client)) ?? { _id: null, name: c.name };
      push(holder, "card", `Access card ${c.cardNumber}`, c.expiryDate);
    }
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
  /** Servable URL for the employee photo; empty when none is set. */
  photoUrl: string;
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
      .select("name employeeCode designation department reportingTo reportingToKind user photo")
      .populate("department", "name")
      .lean<Array<{ _id: unknown; name: string; employeeCode?: string; designation?: string; department?: { name?: string } | null; reportingTo?: unknown; reportingToKind?: string; user?: unknown; photo?: string }>>();

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
      department: e.department?.name ?? null, photoUrl: e.photo ? publicUrl(e.photo) : "", children: [],
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
    const [birthdays, anniversaries, onLeaveToday, workingFromHomeToday, pendingLeaves, pendingRegs, pendingLeaveCount, pendingRegCount, servingNotice, servingNoticeCount, expiringDocs, upcomingBdays, upcomingAnnivs, joiners, resignations, dueConfirmations] = await Promise.all([
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
      upcomingBirthdays(30, getOrgId()),
      upcomingAnniversaries(7, getOrgId()),
      recentJoiners(30, getOrgId()),
      recentResignations(30, getOrgId()),
      confirmationsDue(30, getOrgId()),
    ]);

    return {
      date: start.toISOString().slice(0, 10),
      birthdays,
      anniversaries,
      upcomingBirthdays: upcomingBdays,
      upcomingAnniversaries: upcomingAnnivs,
      newJoiners: joiners,
      recentResignations: resignations,
      dueConfirmations: dueConfirmations.slice(0, 8),
      onLeaveToday,
      workingFromHomeToday,
      pendingLeaves,
      pendingRegularizations: pendingRegs,
      servingNotice,
      expiringDocuments: expiringDocs.slice(0, 8),
      counts: {
        birthdays: birthdays.length,
        anniversaries: anniversaries.length,
        upcomingBirthdays: upcomingBdays.length,
        upcomingAnniversaries: upcomingAnnivs.length,
        newJoiners: joiners.length,
        recentResignations: resignations.length,
        dueConfirmations: dueConfirmations.length,
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
