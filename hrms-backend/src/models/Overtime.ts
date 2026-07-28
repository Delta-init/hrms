import mongoose, { Schema } from "mongoose";
import type { IOvertime } from "../types/index.js";

/** Overtime worked by an employee, paid out on a month's payslip as an earning.
 *  amount = hours × hourlyRate × multiplier, computed on save. Consumed by the
 *  payroll run, then marked applied. */
const overtimeSchema = new Schema<IOvertime>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: [true, "Employee is required"] },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    date: { type: Date, required: [true, "Date is required"] },
    hours: { type: Number, required: [true, "Hours are required"], min: 0 },
    hourlyRate: { type: Number, required: [true, "Hourly rate is required"], min: 0 },
    multiplier: { type: Number, default: 1.5, min: 1 },
    amount: { type: Number, default: 0, min: 0 },
    /** Payout month (YYYY-MM). */
    month: { type: String, required: [true, "Month is required"], match: /^\d{4}-\d{2}$/ },
    notes: { type: String, trim: true, maxlength: 300 },
    applied: { type: Boolean, default: false },
    payslip: { type: Schema.Types.ObjectId, ref: "Payslip", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

// Keep amount in sync with hours/rate/multiplier.
overtimeSchema.pre("save", function (next) {
  this.amount = Math.round((this.hours || 0) * (this.hourlyRate || 0) * (this.multiplier || 1) * 100) / 100;
  next();
});

overtimeSchema.index({ organization: 1, employee: 1, month: 1 });

export const Overtime = mongoose.model<IOvertime>("Overtime", overtimeSchema);
