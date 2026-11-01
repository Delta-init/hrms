import mongoose, { Schema } from "mongoose";

/**
 * A salesperson's salary for one month as the CRM salary slabs set it (the user, 2026-11-01: "the salary from the
 * slab in HRMS, and LOP calculated on it"). Copied from Root — which works it out from each sales CRM's month — by
 * an HR refresh, and kept, so a payslip can be rebuilt the same way later without asking Root again.
 *
 * Matched to an employee by email. While a row exists for an employee and month, that is their salary for the
 * month: the payslip's Basic, the figure loss of pay and penalties are priced off, and — for a payslip imported
 * from a salary sheet — what the sheet's Basic is replaced by.
 */
export interface ICrmSlabSalary {
  organization: mongoose.Types.ObjectId | null;
  month: string;
  email: string;
  employee: mongoose.Types.ObjectId | null;
  crm: string;
  crmName: string;
  name: string;
  role: string;
  level: string;
  salary: number;
  /** The CRM commission payable that month — shown beside it; finance pays it through payroll. */
  payable: number;
  fetchedAt: Date;
  fetchedBy: mongoose.Types.ObjectId | null;
}

const crmSlabSalarySchema = new Schema<ICrmSlabSalary>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    email: { type: String, required: true, trim: true, lowercase: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    crm: { type: String, required: true },
    crmName: { type: String, default: "" },
    name: { type: String, default: "" },
    role: { type: String, default: "" },
    level: { type: String, default: "" },
    salary: { type: Number, required: true, min: 0 },
    payable: { type: Number, default: 0, min: 0 },
    fetchedAt: { type: Date, required: true },
    fetchedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

crmSlabSalarySchema.index({ organization: 1, month: 1, email: 1 }, { unique: true });
crmSlabSalarySchema.index({ organization: 1, month: 1, employee: 1 });

export const CrmSlabSalary = mongoose.model<ICrmSlabSalary>("CrmSlabSalary", crmSlabSalarySchema);
