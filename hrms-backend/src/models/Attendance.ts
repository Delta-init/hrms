import mongoose, { Schema } from "mongoose";
import type { IAttendance, IAttendanceSession, IPunchSource } from "../types/index.js";

/**
 * Where a punch came from. Optional throughout: every record written before
 * face check-in existed has none, and those are web punches by definition.
 */
const punchSourceSchema = new Schema<IPunchSource>(
  {
    method: { type: String, enum: ["web", "face", "manual"], default: "web" },
    kiosk: { type: Schema.Types.ObjectId, ref: "Kiosk", default: null },
    matchScore: { type: Number, default: null },
    proofKey: { type: String, default: null },

    // ── Where the punch came from ──
    // Recorded for remote check-ins, where no kiosk saw the person and this is
    // the only account of where the day started. Absent on every punch made
    // before it was collected, and on any where the browser declined to say.
    //
    // Server-observed, so not forgeable by the person punching:
    ip: { type: String, trim: true, maxlength: 64, default: null },
    country: { type: String, trim: true, uppercase: true, maxlength: 2, default: null },
    city: { type: String, trim: true, maxlength: 80, default: null },
    region: { type: String, trim: true, maxlength: 80, default: null },
    userAgent: { type: String, trim: true, maxlength: 400, default: null },
    browser: { type: String, trim: true, maxlength: 40, default: null },
    os: { type: String, trim: true, maxlength: 40, default: null },
    deviceType: { type: String, enum: ["mobile", "tablet", "desktop"], default: null },

    // Browser-reported, and so corroborating rather than conclusive — devtools
    // can set any coordinates it likes. Rounded to ~100m before storage.
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    accuracy: { type: Number, default: null },
    // Why there is no fix, when there is none — a declined prompt is an
    // ordinary event and reads very differently from a missing field.
    locationSource: {
      type: String,
      enum: ["gps", "denied", "unavailable", "unsupported"],
      default: null,
    },
    timeZone: { type: String, trim: true, maxlength: 60, default: null },

    // Which registered browser this came from, and whether it still looked like
    // the machine it was registered on. A changed fingerprint does not refuse
    // the punch — see Employee.trustedDevice — it marks it for a human.
    deviceLabel: { type: String, trim: true, maxlength: 80, default: null },
    deviceFingerprintChanged: { type: Boolean, default: false },
  },
  { _id: false }
);

const sessionSchema = new Schema<IAttendanceSession>(
  {
    checkIn: { type: Date, required: true },
    checkOut: { type: Date, default: null },
    // Recorded per punch, not per session: someone can be recognised at the
    // kiosk on the way in and clock out from their desk on the way home.
    checkInSource: { type: punchSourceSchema, default: null },
    checkOutSource: { type: punchSourceSchema, default: null },
  },
  { _id: false }
);

const attendanceSchema = new Schema<IAttendance>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
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
