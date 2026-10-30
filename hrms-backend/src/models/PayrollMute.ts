import mongoose, { Schema, type Types } from "mongoose";

export interface IPayrollMute {
  _id: Types.ObjectId;
  organization?: Types.ObjectId | null;
  employee: Types.ObjectId;
  /** YYYY-MM. */
  month: string;
  reason?: string;
  by?: Types.ObjectId | null;
  /**
   * What muting moved on to the next month — payments that would otherwise
   * have waited on a payslip that is not coming — so unmuting can bring back
   * exactly those, and only while they are still unpaid.
   */
  moved: { oneTime: Types.ObjectId[]; reimbursements: Types.ObjectId[]; overtime: Types.ObjectId[] };
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Somebody left out of a month's payroll on purpose: no salary, and nothing
 * deducted. No payslip is made, so loans run a month longer and one-time
 * deductions wait for the next payslip on their own; payments due that month
 * are moved to the next.
 */
const payrollMuteSchema = new Schema<IPayrollMute>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    reason: { type: String, trim: true, maxlength: 300, default: "" },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    moved: {
      oneTime: { type: [Schema.Types.ObjectId], default: [] },
      reimbursements: { type: [Schema.Types.ObjectId], default: [] },
      overtime: { type: [Schema.Types.ObjectId], default: [] },
    },
  },
  { timestamps: true, versionKey: false }
);

payrollMuteSchema.index({ organization: 1, employee: 1, month: 1 }, { unique: true });
payrollMuteSchema.index({ organization: 1, month: 1 });

export const PayrollMute = mongoose.model<IPayrollMute>("PayrollMute", payrollMuteSchema);
