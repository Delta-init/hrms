import { Employee } from "../models/Employee.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Regularization } from "../models/Regularization.js";

/** Employees whose birthday (month + day of dob) falls on the given date. */
export async function birthdaysOn(date = new Date()) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return Employee.aggregate([
    { $match: { dob: { $ne: null } } },
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

    const [birthdays, onLeaveToday, pendingLeaves, pendingRegs, pendingLeaveCount, pendingRegCount] = await Promise.all([
      birthdaysOn(now),
      LeaveRequest.find({ status: "approved", startDate: { $lte: end }, endDate: { $gte: start } })
        .populate("user", "name email designation").sort({ startDate: 1 }).limit(50).lean(),
      LeaveRequest.find({ status: "pending" })
        .populate("user", "name email designation").sort({ createdAt: -1 }).limit(8).lean(),
      Regularization.find({ status: "pending" })
        .populate("user", "name email designation").sort({ createdAt: -1 }).limit(8).lean(),
      LeaveRequest.countDocuments({ status: "pending" }),
      Regularization.countDocuments({ status: "pending" }),
    ]);

    return {
      date: start.toISOString().slice(0, 10),
      birthdays,
      onLeaveToday,
      pendingLeaves,
      pendingRegularizations: pendingRegs,
      counts: {
        birthdays: birthdays.length,
        onLeaveToday: onLeaveToday.length,
        pendingLeaves: pendingLeaveCount,
        pendingRegularizations: pendingRegCount,
      },
    };
  }
}
