import mongoose, { Schema, type Types } from "mongoose";

export interface IPayrollLopOverride {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | null;
  employee: Types.ObjectId;
  /** YYYY-MM. */
  month: string;
  /** The loss-of-pay days HR settled on, in place of what attendance came to. */
  days: number;
  reason: string;
  by?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * HR's figure for one person's loss of pay in one month.
 *
 * Kept apart from the payslip, because the number has to hold before a payslip
 * exists (the run row, the generate dialog) and after one is moved back to not
 * generated — and every payroll path asks the same function for attendance, so
 * a record here is read by all of them without each learning about it. Always
 * with a reason: a payslip that disagrees with the attendance beside it needs
 * to say why.
 */
const payrollLopOverrideSchema = new Schema<IPayrollLopOverride>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    days: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true, trim: true, maxlength: 300 },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

payrollLopOverrideSchema.index({ organization: 1, employee: 1, month: 1 }, { unique: true });

export const PayrollLopOverride = mongoose.model<IPayrollLopOverride>("PayrollLopOverride", payrollLopOverrideSchema);
