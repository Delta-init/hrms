import mongoose, { Schema } from "mongoose";
import type { IAttendance, IAttendanceSession } from "../types/index.js";

const sessionSchema = new Schema<IAttendanceSession>(
  {
    checkIn: { type: Date, required: true },
    checkOut: { type: Date, default: null },
  },
  { _id: false }
);

const attendanceSchema = new Schema<IAttendance>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required"],
    },
    date: {
      type: Date,
      required: [true, "Date is required"],
    },
    // "Time region" — IANA time zone the punches are measured in.
    timeZone: {
      type: String,
      required: [true, "Time zone is required"],
      default: "Asia/Dubai",
      trim: true,
    },
    checkIn: { type: Date, default: null }, // login
    checkOut: { type: Date, default: null }, // logout
    sessions: { type: [sessionSchema], default: [] },
    status: {
      type: String,
      enum: ["present", "absent", "late", "half_day", "on_leave", "holiday", "weekend", "wfh"],
      default: "present",
    },
    workedMinutes: { type: Number, default: 0, min: 0 },
    lateMinutes: { type: Number, default: 0, min: 0 },
    leaveRequest: {
      type: Schema.Types.ObjectId,
      ref: "LeaveRequest",
      default: null,
    },
    note: { type: String, trim: true, maxlength: [500, "Note cannot exceed 500 characters"] },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// One attendance record per user per calendar day.
attendanceSchema.index({ user: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1 });
attendanceSchema.index({ status: 1 });

/** Sum of completed session durations, in whole minutes. */
attendanceSchema.methods.computeWorkedMinutes = function (): number {
  const sessions = (this.sessions ?? []) as IAttendanceSession[];
  let total = 0;
  for (const s of sessions) {
    if (s.checkIn && s.checkOut) {
      total += Math.max(0, (s.checkOut.getTime() - s.checkIn.getTime()) / 60000);
    }
  }
  return Math.round(total);
};

// Keep checkIn/checkOut mirrors + workedMinutes in sync with sessions on save.
attendanceSchema.pre("save", function (next) {
  const sessions = (this.sessions ?? []) as IAttendanceSession[];
  if (sessions.length > 0) {
    const withIn = sessions.filter((s) => s.checkIn);
    if (withIn.length > 0) {
      this.checkIn = withIn.reduce((a, b) => (a.checkIn < b.checkIn ? a : b)).checkIn;
    }
    const withOut = sessions.filter((s) => s.checkOut);
    if (withOut.length > 0) {
      this.checkOut = withOut.reduce((a, b) => (a.checkOut! > b.checkOut! ? a : b)).checkOut ?? null;
    }
  }
  this.workedMinutes = this.computeWorkedMinutes();
  next();
});

export const Attendance = mongoose.model<IAttendance>("Attendance", attendanceSchema);
