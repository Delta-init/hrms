import mongoose, { Schema } from "mongoose";
import type { IMeetingBooking } from "../types/index.js";

/**
 * One room, held for a stretch of time, by somebody, for some people.
 *
 * Times are stored as instants. A meeting is a moment, not a wall-clock
 * reading: two people in different time zones looking at the same booking must
 * see the same moment, and a clash is a clash whatever either of their clocks
 * says. The organiser's zone is kept alongside so the booking can be shown back
 * in the zone it was made in.
 *
 * `firedStages` is the same ledger the reminders use — written before the mail
 * goes out, so a job that runs every five minutes cannot tell twenty people
 * about the same meeting twice.
 */
const meetingBookingSchema = new Schema<IMeetingBooking>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    room: { type: Schema.Types.ObjectId, ref: "MeetingRoom", required: [true, "Room is required"], index: true },
    title: { type: String, required: [true, "Title is required"], trim: true, maxlength: 140 },
    agenda: { type: String, trim: true, maxlength: 1000 },
    start: { type: Date, required: [true, "Start is required"], index: true },
    end: { type: Date, required: [true, "End is required"] },
    timeZone: { type: String, default: "Asia/Dubai", trim: true, maxlength: 64 },
    organizer: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    /** Employees with a login — the only people this can reach. */
    participants: { type: [{ type: Schema.Types.ObjectId, ref: "User" }], default: [] },
    status: { type: String, enum: ["booked", "cancelled"], default: "booked", index: true },
    firedStages: { type: [String], default: [] },
  },
  { timestamps: true, versionKey: false }
);

// The clash lookup: one room, the bookings still standing, ordered by start.
meetingBookingSchema.index({ room: 1, status: 1, start: 1 });
meetingBookingSchema.index({ organization: 1, start: 1 });

export const MeetingBooking = mongoose.model<IMeetingBooking>("MeetingBooking", meetingBookingSchema);
