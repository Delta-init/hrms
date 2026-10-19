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
    /** Required unless another system made it (`source`) for somebody with no login here. */
    organizer: {
      type: Schema.Types.ObjectId, ref: "User", index: true, default: null,
      required: [function (this: { source?: { system?: string } | null }) { return !this.source?.system; }, "Organizer is required"],
    },
    /** Employees with a login — the only people this can reach. */
    participants: { type: [{ type: Schema.Types.ObjectId, ref: "User" }], default: [] },
    status: { type: String, enum: ["booked", "cancelled"], default: "booked", index: true },
    firedStages: { type: [String], default: [] },
    /** Made by another system (the LMS's class pods, 2026-10-18): which, for what, and the name shown for it. */
    source: {
      type: new Schema({ system: { type: String, required: true }, ref: { type: String, required: true }, label: { type: String, default: "" } }, { _id: false }),
      default: null,
    },

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
    /**
     * Every time someone opened the meeting through HRMS's join page: where
     * they were, against where they clocked in today. Online review meetings
     * only — the real link is handed out there and nowhere else.
     */
    joins: {
      type: [new Schema({
        user: { type: Schema.Types.ObjectId, ref: "User", required: true },
        at: { type: Date, required: true },
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true },
        accuracy: { type: Number, default: null },
        clockedIn: { type: Boolean, default: false },
        /** Metres from today's clock-in position, when there was one. */
        distanceMetres: { type: Number, default: null },
        sameLocation: { type: Boolean, default: null },
        /** Whole minutes after the start; 0 for anyone in before it. */
        lateMinutes: { type: Number, default: null },
      }, { _id: false })],
      default: [],
    },
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
meetingBookingSchema.index({ "source.system": 1, "source.ref": 1, status: 1 });

export const MeetingBooking = mongoose.model<IMeetingBooking>("MeetingBooking", meetingBookingSchema);
