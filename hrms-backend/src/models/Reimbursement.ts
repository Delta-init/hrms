import mongoose, { Schema } from "mongoose";
import type { IReimbursement } from "../types/index.js";
import { workflowStateFields } from "./approvalWorkflowFields.js";

/** An employee expense-reimbursement claim. Submitted by the employee, reviewed
 *  by HR/a manager, and — once approved — paid out through a payslip, at which
 *  point its status becomes "paid" and it is linked to that payslip.
 *
 *  With REIMBURSEMENT_FINANCE_STEP=on (2026-11-16) HR's approval passes it to
 *  finance instead ("hr_approved"), and finance pays it directly: "paid", with
 *  finance's expense number and no payslip. */
const reimbursementSchema = new Schema<IReimbursement>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: [true, "Employee is required"] },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    category: {
      type: String,
      enum: ["travel", "food", "accommodation", "medical", "communication", "fuel", "supplies", "other"],
      default: "other",
    },
    title: { type: String, required: [true, "Title is required"], trim: true, maxlength: 120 },
    amount: { type: Number, required: [true, "Amount is required"], min: 0 },
    expenseDate: { type: Date, required: [true, "Expense date is required"] },
    /** Payout month (YYYY-MM). */
    month: { type: String, required: [true, "Month is required"], match: /^\d{4}-\d{2}$/ },
    description: { type: String, trim: true, maxlength: 500 },
    receiptUrl: { type: String, trim: true, maxlength: 500 },
    /** hr_approved: HR approved it and it waits on finance, which pays it ("paid") or refuses it
     *  (REIMBURSEMENT_FINANCE_STEP=on). approved: HR's approval was final — paid in a payslip. */
    status: { type: String, enum: ["pending", "hr_approved", "approved", "rejected", "paid"], default: "pending", index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, trim: true, maxlength: 500 },
    ...workflowStateFields,
    payslip: { type: Schema.Types.ObjectId, ref: "Payslip", default: null },
    rejectedBy: { type: String, enum: ["hr", "finance", null], default: null },
    /** What was claimed, when finance paid a different amount (2026-11-16) — `amount` is then what was paid. */
    requestedAmount: { type: Number, min: 0, default: null },
    // Finance's half, from the finance system — never a user here.
    financeRef: { type: String, trim: true, maxlength: 120, default: "" },
    paidOn: { type: Date, default: null },
    paymentMethod: { type: String, trim: true, maxlength: 40, default: "" },
    financeNote: { type: String, trim: true, maxlength: 500, default: "" },
    financeReviewedBy: { type: String, trim: true, maxlength: 120, default: "" },
    financeReviewedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

reimbursementSchema.index({ organization: 1, employee: 1, month: 1 });
reimbursementSchema.index({ organization: 1, status: 1, month: 1 });

export const Reimbursement = mongoose.model<IReimbursement>("Reimbursement", reimbursementSchema);
