import mongoose, { Schema } from "mongoose";
import type { IWorkSchedule } from "../types/index.js";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Leave a schedule grants, by type.
 *
 * Attached to the schedule rather than the organization because entitlement
 * follows the shift someone works, and it is the schedule that already says
 * which days they are expected to be in. A type absent from this list cannot be
 * requested at all — the list is the menu, not a set of limits on a fixed menu.
 *
 * `paid` is what payroll reads: an unpaid day off costs a day's salary, a paid
 * one does not, and that cannot be inferred from the name once an organization
 * has its own idea of whether casual leave is paid.
 */
const scheduleLeaveSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 40,
      match: /^[a-z0-9_]+$/,
    },
    /** Display name for a type the built-in list doesn't cover. */
    label: { type: String, trim: true, maxlength: 60 },
    /** Days granted per month. */
    monthlyDays: { type: Number, required: true, min: 0, max: 31 },
    paid: { type: Boolean, default: true },
  },
  { _id: false }
);

const workScheduleSchema = new Schema<IWorkSchedule>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [80, "Name cannot exceed 80 characters"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [300, "Description cannot exceed 300 characters"],
    },
    // Region
    timeZone: {
      type: String,
      required: [true, "Time zone is required"],
      default: "Asia/Dubai",
      trim: true,
    },
    loginTime: {
      type: String,
      required: [true, "Login time is required"],
      match: [TIME_RE, "Login time must be in HH:mm format"],
      default: "09:00",
    },
    logoutTime: {
      type: String,
      required: [true, "Logout time is required"],
      match: [TIME_RE, "Logout time must be in HH:mm format"],
      default: "18:00",
    },
    // 0 = Sunday … 6 = Saturday. Default Mon–Fri.
    workDays: {
      type: [Number],
      default: [1, 2, 3, 4, 5, 6],
    },
    // Subset of workDays worked as half-days.
    halfDays: {
      type: [Number],
      default: [],
    },
    graceMinutes: {
      type: Number,
      default: 10,
      min: 0,
    },
    leavePolicies: { type: [scheduleLeaveSchema], default: [] },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

workScheduleSchema.index({ organization: 1, name: 1 }, { unique: true });

export const WorkSchedule = mongoose.model<IWorkSchedule>("WorkSchedule", workScheduleSchema);
