import mongoose, { Schema } from "mongoose";
import type { IPayrollBatch } from "../types/index.js";

/**
 * A month's payroll as a single thing that can be handed over.
 *
 * Payslips already carry their own status, but a per-employee status cannot
 * answer "has this month been given to accounts yet?" — which is the question
 * the whole three-step handover turns on. This record answers it once for the
 * month, and its status is what freezes the payslips underneath it.
 *
 * Deliberately created lazily. A month with no batch row is a draft month, so
 * reading a payroll page does not litter the collection with rows for months
 * nobody ran. The row appears when HR submits, which is the first moment
 * anything about the month needs to be remembered.
 */
const historySchema = new Schema(
  {
    from: { type: String, required: true },
    to: { type: String, required: true },
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /**
     * Who moved it, when that is not one of our own users — "finance" for a
     * transition the accounts system made over the integration API. Without it
     * the trail says a payroll approved itself.
     */
    actor: { type: String, required: true, default: "hr" },
    note: { type: String, trim: true, maxlength: 300 },
  },
  { _id: false }
);

const payrollBatchSchema = new Schema<IPayrollBatch>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    month: { type: String, required: true, match: [/^\d{4}-\d{2}$/, "Month must be YYYY-MM"] },
    monthDate: { type: Date, required: true },
    currency: { type: String, default: "AED", uppercase: true, trim: true, maxlength: 6 },
    status: {
      type: String,
      enum: ["draft", "submitted", "in_finance", "approved", "partially_paid", "paid", "returned"],
      default: "draft",
    },

    // A snapshot taken at submit, not a live total. What finance was handed has
    // to stay legible even after a later phase adds figures of its own.
    employeeCount: { type: Number, default: 0, min: 0 },
    grossTotal: { type: Number, default: 0 },
    deductionTotal: { type: Number, default: 0 },
    netTotal: { type: Number, default: 0 },

    submittedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    submittedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    returnedAt: { type: Date, default: null },
    returnReason: { type: String, trim: true, maxlength: 300 },

    financeRunId: { type: String, trim: true, default: "" },

    /**
     * Payments accounts have already told us about.
     *
     * Recorded so a re-delivered notification is recognised rather than
     * re-applied. The caller cannot tell a timeout from a failure, and without
     * this a retry would mark a second set of payslips paid — or the same ones
     * twice, with a fresh paidAt each time, quietly rewriting when somebody was
     * paid.
     */
    payments: {
      type: [
        new Schema(
          {
            paymentId: { type: String, required: true },
            paidOn: { type: Date, required: true },
            reference: { type: String, trim: true, default: "" },
            method: { type: String, trim: true, default: "" },
            payslipCount: { type: Number, default: 0 },
            amount: { type: Number, default: 0 },
            recordedAt: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    history: { type: [historySchema], default: [] },
  },
  { timestamps: true, versionKey: false }
);

// One batch per organization per month.
payrollBatchSchema.index({ organization: 1, month: 1 }, { unique: true });
payrollBatchSchema.index({ status: 1 });

export const PayrollBatch = mongoose.model<IPayrollBatch>("PayrollBatch", payrollBatchSchema);
