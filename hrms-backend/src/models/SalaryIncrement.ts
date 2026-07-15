import mongoose, { Schema } from "mongoose";
import type { ISalaryIncrement } from "../types/index.js";

const salaryIncrementSchema = new Schema<ISalaryIncrement>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: [true, "Employee is required"] },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** Salary in force just before this increment (snapshot, for display). */
    previousSalary: { type: Number, min: 0, default: 0 },
    newSalary: { type: Number, required: [true, "New salary is required"], min: 0 },
    /** Payout month this raise takes effect (YYYY-MM). */
    effectiveMonth: { type: String, required: [true, "Effective month is required"], match: /^\d{4}-\d{2}$/ },
    reason: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

salaryIncrementSchema.index({ employee: 1, effectiveMonth: -1 });

export const SalaryIncrement = mongoose.model<ISalaryIncrement>("SalaryIncrement", salaryIncrementSchema);
