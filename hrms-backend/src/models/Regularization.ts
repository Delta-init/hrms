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
