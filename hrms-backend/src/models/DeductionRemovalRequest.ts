import mongoose, { Schema } from "mongoose";
import type { IDeductionRemovalRequest } from "../types/index.js";

/**
 * An employee asking that a specific loan instalment or one-time deduction
 * not be taken for a given month.
 *
 * The source (`sourceType` + `sourceId`) points at a Loan or an
 * OneTimeAdjustment, but its label and amount are copied here rather than
 * populated fresh each time — a loan's balance moves every month, and a
 * request approved weeks later should still read as what was actually asked
 * for, not today's figure.
 */
const deductionRemovalRequestSchema = new Schema<IDeductionRemovalRequest>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    month: { type: String, required: [true, "Month is required"], match: /^\d{4}-\d{2}$/ },
    sourceType: { type: String, enum: ["loan", "adjustment"], required: true },
    sourceId: { type: Schema.Types.ObjectId, required: true },
    sourceLabel: { type: String, required: true, trim: true, maxlength: 100 },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, required: [true, "A reason is required"], trim: true, maxlength: 500 },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewNote: { type: String, trim: true, maxlength: 500 },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

// One open request per deduction per month — asking twice while the first is
// still pending is a resubmit, not a second request.
deductionRemovalRequestSchema.index(
  { employee: 1, sourceType: 1, sourceId: 1, month: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);
deductionRemovalRequestSchema.index({ organization: 1, status: 1, createdAt: -1 });

export const DeductionRemovalRequest = mongoose.model<IDeductionRemovalRequest>(
  "DeductionRemovalRequest",
  deductionRemovalRequestSchema
);
