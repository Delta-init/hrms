import mongoose, { Schema } from "mongoose";
import type { ILoan } from "../types/index.js";

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
  },
  { timestamps: true, versionKey: false }
);

loanSchema.index({ employee: 1, status: 1 });

export const Loan = mongoose.model<ILoan>("Loan", loanSchema);
