import mongoose from "mongoose";
import { Employee } from "../models/Employee.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Regularization } from "../models/Regularization.js";
import { Resignation } from "../models/Resignation.js";
import { orgFilter, getOrgId } from "../utils/orgContext.js";

/** Employees whose birthday (month + day of dob) falls on the given date. */
export async function birthdaysOn(date = new Date(), orgId?: string | null) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
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

export class DashboardService {
  /** Aggregated HR snapshot: birthdays, who's out today, and pending approvals. */
  async summary() {
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setHours(23, 59, 59, 999);

    const org = orgFilter();
    const [birthdays, onLeaveToday, pendingLeaves, pendingRegs, pendingLeaveCount, pendingRegCount, servingNotice, servingNoticeCount] = await Promise.all([
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
    ]);

    return {
      date: start.toISOString().slice(0, 10),
      birthdays,
      onLeaveToday,
      pendingLeaves,
      pendingRegularizations: pendingRegs,
      servingNotice,
      counts: {
        birthdays: birthdays.length,
        onLeaveToday: onLeaveToday.length,
        pendingLeaves: pendingLeaveCount,
        pendingRegularizations: pendingRegCount,
        servingNotice: servingNoticeCount,
      },
    };
  }
}
