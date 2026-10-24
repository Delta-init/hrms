import mongoose, { Schema } from "mongoose";
import type { ILeaveRequest } from "../types/index.js";
import { workflowStateFields } from "./approvalWorkflowFields.js";

/** Leave calendar — employee leave applications and their approval status. */
const leaveRequestSchema = new Schema<ILeaveRequest>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required"],
    },
    /**
     * Built-in slug or one a work schedule defines. Not an enum any more:
     * organizations name leave in their own terms, and the schedule that grants
     * a type is what says whether it exists — so validating against a fixed
     * list here would reject the very types an administrator had just created.
     */
    type: {
      type: String,
      required: [true, "Leave type is required"],
      trim: true,
      lowercase: true,
      maxlength: [40, "Leave type cannot exceed 40 characters"],
      match: [/^[a-z0-9_]+$/, "Leave type must be lowercase letters, numbers or underscores"],
    },
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
    },
    endDate: {
      type: Date,
      required: [true, "End date is required"],
    },
    halfDay: {
      type: Boolean,
      default: false,
    },
    days: {
      type: Number,
      required: true,
      min: [0.5, "Leave must be at least half a day"],
    },
    timeZone: {
      type: String,
      required: [true, "Time zone is required"],
      default: "Asia/Dubai",
      trim: true,
    },
    reason: {
      type: String,
      trim: true,
      maxlength: [500, "Reason cannot exceed 500 characters"],
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewNote: {
      type: String,
      trim: true,
      maxlength: [500, "Review note cannot exceed 500 characters"],
    },
    /**
     * Certified Sick Leave: the medical certificate, and when it is due — five
     * hours from applying. No certificate by then and the request becomes unpaid
     * leave; with one, the usual approvers decide: approved is paid, rejected is
     * unpaid. `convertedFrom` keeps what a request was before it became unpaid.
     */
    certificate: {
      type: new Schema({
        key: { type: String, required: true },
        fileName: { type: String, trim: true, maxlength: 260 },
        mimeType: { type: String, trim: true, maxlength: 100 },
        size: { type: Number, min: 0 },
        uploadedAt: { type: Date, default: Date.now },
      }, { _id: false }),
      default: null,
    },
    certificateDueAt: { type: Date, default: null, index: true },
    certificateReminderAt: { type: Date, default: null },
    convertedFrom: { type: String, default: null },
    conversionReason: { type: String, enum: ["no_certificate", "rejected", null], default: null },
    ...workflowStateFields,
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

leaveRequestSchema.index({ user: 1, startDate: 1 });
leaveRequestSchema.index({ status: 1 });
leaveRequestSchema.index({ startDate: 1, endDate: 1 });

// Basic guard: endDate must not precede startDate.
leaveRequestSchema.pre("validate", function (next) {
  if (this.startDate && this.endDate && this.endDate < this.startDate) {
    next(new Error("End date cannot be before start date"));
    return;
  }
  next();
});

export const LeaveRequest = mongoose.model<ILeaveRequest>("LeaveRequest", leaveRequestSchema);
