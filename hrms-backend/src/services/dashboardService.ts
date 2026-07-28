import mongoose from "mongoose";
import { Employee } from "../models/Employee.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Regularization } from "../models/Regularization.js";
import { Resignation } from "../models/Resignation.js";
import { orgFilter, getOrgId } from "../utils/orgContext.js";

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

export class DashboardService {
  /** Full list of expiring passports/visas within the window (default 90 days). */
  async documentExpiry(withinDays = 90) {
    return expiringDocuments(withinDays, getOrgId());
  }

  /** Aggregated HR snapshot: birthdays, who's out today, and pending approvals. */
  async summary() {
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setHours(23, 59, 59, 999);

    const org = orgFilter();
    const [birthdays, onLeaveToday, pendingLeaves, pendingRegs, pendingLeaveCount, pendingRegCount, servingNotice, servingNoticeCount, expiringDocs] = await Promise.all([
      birthdaysOn(now, getOrgId()),
      LeaveRequest.find({ ...org, status: "approved", startDate: { $lte: end }, endDate: { $gte: start } })
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
      onLeaveToday,
      pendingLeaves,
      pendingRegularizations: pendingRegs,
      servingNotice,
      expiringDocuments: expiringDocs.slice(0, 8),
      counts: {
        birthdays: birthdays.length,
        onLeaveToday: onLeaveToday.length,
        pendingLeaves: pendingLeaveCount,
        pendingRegularizations: pendingRegCount,
        servingNotice: servingNoticeCount,
        expiringDocuments: expiringDocs.length,
      },
    };
  }
}
