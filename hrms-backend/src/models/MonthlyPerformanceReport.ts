import mongoose, { Schema } from "mongoose";
import type { IMonthlyPerformanceReport } from "../types/index.js";

/**
 * One employee's performance report for one month.
 *
 * Written in either or both: typed straight in, or attached as a file (same
 * 10MB path a candidate's CV or a requisition's JD already use). Filed by the
 * employee themselves or their department head — see monthlyPerformanceReportService
 * for who that actually is, which is not a route-level permission but a check
 * against the org chart, the same way a department head's other access is.
 *
 * One per employee per month: filing again for a month already on file
 * replaces it rather than piling up duplicates nobody reads in order.
 */
const monthlyPerformanceReportSchema = new Schema<IMonthlyPerformanceReport>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    month: { type: String, required: [true, "Month is required"], match: /^\d{4}-\d{2}$/ },
    reportText: { type: String, trim: true, maxlength: 5000, default: "" },
    reportKey: { type: String, trim: true, default: "" },
    reportFileName: { type: String, trim: true, maxlength: 200, default: "" },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, versionKey: false }
);

monthlyPerformanceReportSchema.index({ organization: 1, employee: 1, month: 1 }, { unique: true });

export const MonthlyPerformanceReport = mongoose.model<IMonthlyPerformanceReport>(
  "MonthlyPerformanceReport",
  monthlyPerformanceReportSchema
);
