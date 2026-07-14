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
    /** Amount deducted from each month's salary. */
    monthlyDeduction: { type: Number, min: 0, default: 0 },
    amountRepaid: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: ["active", "closed", "cancelled"], default: "active" },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, versionKey: false }
);

loanSchema.index({ employee: 1, status: 1 });

export const Loan = mongoose.model<ILoan>("Loan", loanSchema);
