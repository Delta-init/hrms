import mongoose, { Schema } from "mongoose";
import type { IWorkSchedule } from "../types/index.js";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const workScheduleSchema = new Schema<IWorkSchedule>(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      unique: true,
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
      default: [1, 2, 3, 4, 5],
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

export const WorkSchedule = mongoose.model<IWorkSchedule>("WorkSchedule", workScheduleSchema);
