import mongoose, { Schema } from "mongoose";
import type { ILeaveRequest } from "../types/index.js";

/** Leave calendar — employee leave applications and their approval status. */
const leaveRequestSchema = new Schema<ILeaveRequest>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required"],
    },
    type: {
      type: String,
      enum: ["annual", "sick", "casual", "unpaid", "maternity", "paternity", "wfh"],
      required: [true, "Leave type is required"],
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
