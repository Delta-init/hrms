import mongoose, { Schema } from "mongoose";
import type { IConfirmation } from "../types/index.js";
import { workflowStateFields } from "./approvalWorkflowFields.js";

/**
 * One employee's probation confirmation.
 *
 * Recorded as its own document rather than a flag on Employee so the decision
 * carries a date, an author, notes and — when a workflow is configured — a
 * multi-step approval trail, and so a rejected first attempt stays on the
 * record instead of being overwritten.
 */
const confirmationSchema = new Schema<IConfirmation>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: [true, "Employee is required"] },
    /** Probation end derived at creation: joining date + probation days. */
    dueDate: { type: Date, default: null },
    /** The date confirmation takes effect (HR may back- or forward-date it). */
    confirmationDate: { type: Date, required: [true, "Confirmation date is required"] },
    status: {
      type: String,
      enum: ["pending", "confirmed", "rejected"],
      default: "pending",
      index: true,
    },
    notes: { type: String, trim: true, maxlength: 1000 },
    ...workflowStateFields,
    initiatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, versionKey: false }
);

// One in-flight confirmation per employee; settled ones are kept as history.
confirmationSchema.index(
  { employee: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);

export const Confirmation = mongoose.model<IConfirmation>("Confirmation", confirmationSchema);
