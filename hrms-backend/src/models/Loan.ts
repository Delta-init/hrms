import mongoose, { Schema } from "mongoose";
import type { ILoan } from "../types/index.js";

/**
 * HR's change to one month of the schedule: 0 skips the month, a smaller
 * amount takes that much. The instalment itself never changes, so what the
 * month did not take moves to the end of the loan.
 */
const monthPlanSchema = new Schema(
  {
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, trim: true, maxlength: 300 },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

/** Money the employee paid back outside payroll — cash, a transfer, a cheque. */
const directPaymentSchema = new Schema(
  {
    amount: { type: Number, required: true, min: 0.01 },
    date: { type: Date, required: true },
    method: { type: String, enum: ["cash", "bank_transfer", "cheque", "other"], default: "cash" },
    /** Receipt or transaction number. */
    reference: { type: String, trim: true, maxlength: 120 },
    note: { type: String, trim: true, maxlength: 300 },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: true }
);

const loanSchema = new Schema<ILoan>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: [true, "Employee is required"] },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    amount: { type: Number, required: [true, "Loan amount is required"], min: 0 },
    purpose: { type: String, trim: true, maxlength: 200 },
    disbursedDate: { type: Date, default: null },
    /** Number of monthly instalments over which the loan is repaid. */
    installments: { type: Number, min: 1, default: 1 },
    /**
     * Amount deducted from each month's salary — always `amount / installments`,
     * recomputed by the service on every create/update. Never set this from a
     * client-submitted value; see LoanService.
     */
    monthlyDeduction: { type: Number, min: 0, default: 0 },
    amountRepaid: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: ["active", "closed", "cancelled"], default: "active" },
    notes: { type: String, trim: true, maxlength: 500 },
    /**
     * "advance" when this recovers an approved salary advance rather than a
     * loan HR raised. Same schedule and same recovery; it only changes what
     * the payslip line is called ("Salary advance") and which column of the
     * salary sheet it lands in.
     */
    kind: { type: String, enum: ["loan", "advance"], default: "loan" },
    /** The salary advance request it came from, when `kind` is "advance". */
    advance: { type: Schema.Types.ObjectId, ref: "SalaryAdvance", default: null },
    /** Months HR skipped or took less in — one entry per month at most. */
    monthPlans: { type: [monthPlanSchema], default: [] },
    /** Repaid directly; counted in `amountRepaid` like a payslip's recovery. */
    directPayments: { type: [directPaymentSchema], default: [] },
  },
  { timestamps: true, versionKey: false }
);

loanSchema.index({ employee: 1, status: 1 });

export const Loan = mongoose.model<ILoan>("Loan", loanSchema);
