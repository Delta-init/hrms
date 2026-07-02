import mongoose, { Schema } from "mongoose";
import type { IPayslip, IPayslipLine } from "../types/index.js";

const lineSchema = new Schema<IPayslipLine>(
  {
    label: { type: String, required: true, trim: true, maxlength: 60 },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const payslipSchema = new Schema<IPayslip>(
  {
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: [true, "Employee is required"] },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    month: { type: String, required: [true, "Month is required"], match: [/^\d{4}-\d{2}$/, "Month must be YYYY-MM"] },
    monthDate: { type: Date, required: true },
    currency: { type: String, default: "AED", uppercase: true, trim: true, maxlength: 6 },
    earnings: { type: [lineSchema], default: [] },
    deductions: { type: [lineSchema], default: [] },
    grossPay: { type: Number, default: 0, min: 0 },
    totalDeductions: { type: Number, default: 0, min: 0 },
    netPay: { type: Number, default: 0 },
    workingDays: { type: Number, default: 0, min: 0 },
    paidDays: { type: Number, default: 0, min: 0 },
    lopDays: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["draft", "issued", "paid"], default: "draft" },
    issuedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    issuedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, versionKey: false }
);

// One payslip per employee per month.
payslipSchema.index({ employee: 1, month: 1 }, { unique: true });
payslipSchema.index({ user: 1, month: 1 });
payslipSchema.index({ status: 1 });

// Keep totals in sync.
payslipSchema.pre("save", function (next) {
  const sum = (arr: IPayslipLine[]) => arr.reduce((a, l) => a + (l.amount || 0), 0);
  this.grossPay = Math.round(sum(this.earnings as unknown as IPayslipLine[]) * 100) / 100;
  this.totalDeductions = Math.round(sum(this.deductions as unknown as IPayslipLine[]) * 100) / 100;
  this.netPay = Math.round((this.grossPay - this.totalDeductions) * 100) / 100;
  next();
});

export const Payslip = mongoose.model<IPayslip>("Payslip", payslipSchema);
