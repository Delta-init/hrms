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
    /**
     * Required for a room meeting — checked in the service rather than here,
     * because a review meeting may be online or somewhere else instead.
     */
    room: { type: Schema.Types.ObjectId, ref: "MeetingRoom", default: null, index: true },
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

    /** "review": a review meeting about one employee, with a review form after. */
    kind: { type: String, enum: ["meeting", "review"], default: "meeting", index: true },
    /** Where it happens. A plain meeting is always in a room. */
    mode: { type: String, enum: ["room", "online", "place"], default: "room" },
    meetingLink: { type: String, trim: true, maxlength: 500, default: "" },
    placeAddress: { type: String, trim: true, maxlength: 300, default: "" },
    placeMapUrl: { type: String, trim: true, maxlength: 500, default: "" },
    /** Review meetings: the employee being reviewed, and their login. */
    reviewee: { type: Schema.Types.ObjectId, ref: "Employee", default: null, index: true },
    revieweeUser: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** A link to the recording, wherever the meeting tool kept it. */
    recordingLink: { type: String, trim: true, maxlength: 500, default: "" },
    /** Set when the review is written — the meeting took place. */
    heldAt: { type: Date, default: null },
    review: {
      type: new Schema(
        {
          rating: { type: Number, min: 1, max: 5, default: null },
          strengths: { type: String, trim: true, maxlength: 2000, default: "" },
          improvements: { type: String, trim: true, maxlength: 2000, default: "" },
          actions: {
            type: [new Schema({ text: { type: String, trim: true, maxlength: 300 }, dueDate: { type: Date, default: null } }, { _id: false })],
            default: [],
          },
          outcome: { type: String, enum: ["on_track", "needs_improvement", "performance_plan", null], default: null },
          writtenBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
          writtenAt: { type: Date, default: null },
          acknowledgedAt: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: null,
    },
  },
  { timestamps: true, versionKey: false }
);

// The clash lookup: one room, the bookings still standing, ordered by start.
meetingBookingSchema.index({ room: 1, status: 1, start: 1 });
meetingBookingSchema.index({ organization: 1, start: 1 });

export const MeetingBooking = mongoose.model<IMeetingBooking>("MeetingBooking", meetingBookingSchema);
