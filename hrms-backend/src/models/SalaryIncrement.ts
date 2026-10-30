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
    /**
     * The currency of each figure. Null on records made before these existed,
     * which read as the employee's currency. Kept per increment because a
     * transfer changes it: Nadeem's INR 30,000 to AED 3,000 on moving from
     * India to Dubai read as a 90% cut when both were shown in AED.
     */
    previousCurrency: { type: String, uppercase: true, trim: true, maxlength: 6, default: null },
    currency: { type: String, uppercase: true, trim: true, maxlength: 6, default: null },
    /** Payout month this raise takes effect (YYYY-MM). */
    effectiveMonth: { type: String, required: [true, "Effective month is required"], match: /^\d{4}-\d{2}$/ },
    reason: { type: String, trim: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

salaryIncrementSchema.index({ employee: 1, effectiveMonth: -1 });

export const SalaryIncrement = mongoose.model<ISalaryIncrement>("SalaryIncrement", salaryIncrementSchema);
