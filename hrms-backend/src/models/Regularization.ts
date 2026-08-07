import mongoose, { Schema } from "mongoose";
import type { IRegularization } from "../types/index.js";
import { workflowStateFields } from "./approvalWorkflowFields.js";

const regularizationSchema = new Schema<IRegularization>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    user: { type: Schema.Types.ObjectId, ref: "User", required: [true, "User is required"] },
    date: { type: Date, required: [true, "Date is required"] },
    timeZone: { type: String, required: true, default: "Asia/Dubai", trim: true },
    type: {
      type: String,
      enum: ["missing_checkin", "missing_checkout", "wrong_time", "absent_correction"],
      required: [true, "Type is required"],
    },
    /**
     * What the day becomes once this is approved.
     *
     * Approval used to flip absent to present and leave every other status
     * alone, so a correction could put the right times on a day that stayed
     * marked half-day or late — and nothing on the form said what the day would
     * end up as. Stating it up front makes the outcome reviewable rather than
     * something discovered afterwards on the payslip.
     */
    resultingStatus: {
      type: String,
      enum: ["present", "half_day", "wfh"],
      default: "present",
    },
    requestedCheckIn: { type: Date, default: null },
    requestedCheckOut: { type: Date, default: null },
    reason: { type: String, trim: true, maxlength: [500, "Reason cannot exceed 500 characters"] },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, trim: true, maxlength: [500, "Review note cannot exceed 500 characters"] },
    ...workflowStateFields,
  },
  { timestamps: true, versionKey: false }
);

regularizationSchema.index({ user: 1, date: 1 });
regularizationSchema.index({ status: 1 });

export const Regularization = mongoose.model<IRegularization>("Regularization", regularizationSchema);
