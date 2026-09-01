import mongoose, { Schema } from "mongoose";
import type { IAttendance, IAttendanceSession, IPunchSource } from "../types/index.js";
import { localDayKey } from "../utils/schedule.js";

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

    /**
     * The coordinates as an address, resolved once when the punch is made.
     *
     * Stored rather than looked up on demand: a list of a hundred rows would
     * otherwise be a hundred requests to somebody else's map service every time
     * it is opened, and the address of a place does not change while the
     * attendance record does not.
     *
     * Absent whenever the lookup did not happen or did not answer — there is no
     * fix, the service was slow, it was down. The coordinates stand on their
     * own in that case; the street is a convenience laid over them.
     */
    road: { type: String, trim: true, maxlength: 120, default: null },
    suburb: { type: String, trim: true, maxlength: 120, default: null },
    district: { type: String, trim: true, maxlength: 120, default: null },
    postcode: { type: String, trim: true, maxlength: 20, default: null },
    addressLabel: { type: String, trim: true, maxlength: 300, default: null },

    // Which registered browser this came from, and — when it was not that one —
    // why. Null is the ordinary case: the punch came from the device the person
    // is registered on, or the organization does not track devices at all.
    deviceLabel: { type: String, trim: true, maxlength: 80, default: null },
    deviceAnomaly: {
      type: String,
      enum: ["unknown_device", "no_device", "changed_device"],
      default: null,
    },
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
    /**
     * The calendar day this record belongs to, as it reads where the person
     * works: "2026-09-01".
     *
     * `date` is midnight in that person's own zone, so the same calendar day is
     * a different instant for each of them — 20:00Z for Dubai, 18:30Z for
     * Kolkata. Filtering a range of instants therefore has to pick one zone and
     * be wrong for everybody else: asking for today returned Dubai staff and
     * silently dropped all thirty on Kolkata time, while pulling in their
     * records for tomorrow. Matching on the written day instead is exact for
     * everyone, whatever zone they keep.
     */
    localDay: { type: String, trim: true, maxlength: 10, index: true, default: null },
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
// Every date-range query goes through this, scoped to one organisation.
attendanceSchema.index({ organization: 1, localDay: 1 });
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

/**
 * Keep the checkIn/checkOut mirrors and workedMinutes in step with sessions.
 *
 * Derived outright rather than only written when a value is found. Setting but
 * never clearing meant erasing a logout left the mirror behind: the session
 * said the day was still open, the record still reported a time, and the two
 * were read by different screens. Clearing it in the dialog appeared to do
 * nothing, because the column the table reads had not moved — while
 * workedMinutes, computed from the sessions, dropped to zero beside it.
 */
attendanceSchema.pre("save", function (next) {
  const sessions = (this.sessions ?? []) as IAttendanceSession[];
  const ins = sessions.filter((s) => s.checkIn);
  const outs = sessions.filter((s) => s.checkOut);
  // Earliest way in, latest way out — and null when there is none, so the
  // mirror can never outlive the session it was taken from.
  this.checkIn = ins.length ? ins.reduce((a, b) => (a.checkIn < b.checkIn ? a : b)).checkIn : null;
  this.checkOut = outs.length ? outs.reduce((a, b) => (a.checkOut! > b.checkOut! ? a : b)).checkOut ?? null : null;
  // Derived from the record's own zone, so it stays right when either the day
  // or the zone is corrected — both of which happen when a schedule changes.
  this.localDay = localDayKey(this.date, this.timeZone || "Asia/Dubai");
  this.workedMinutes = this.computeWorkedMinutes();
  next();
});

export const Attendance = mongoose.model<IAttendance>("Attendance", attendanceSchema);
