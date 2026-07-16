import mongoose, { Schema } from "mongoose";
import type { IPayrollChecklistItem } from "../types/index.js";

const payrollChecklistItemSchema = new Schema<IPayrollChecklistItem>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    label: { type: String, required: [true, "Label is required"], trim: true, maxlength: 120 },
    /** Optional in-app route the "take me there" link opens (e.g. "/loans"). */
    link: { type: String, trim: true, maxlength: 200, default: "" },
    order: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
);

payrollChecklistItemSchema.index({ organization: 1, order: 1 });

export const PayrollChecklistItem = mongoose.model<IPayrollChecklistItem>("PayrollChecklistItem", payrollChecklistItemSchema);

/** Defaults seeded per org on first read. */
export const DEFAULT_CHECKLIST: { label: string; link: string }[] = [
  { label: "New Employee additions", link: "/employees" },
  { label: "Employee Separations", link: "/resignations" },
  { label: "Update One Time Payment", link: "/payroll" },
  { label: "Update One Time Deductions", link: "/payroll" },
  { label: "Loans Update", link: "/loans" },
  { label: "Salary Increments", link: "/salary-increments" },
];
