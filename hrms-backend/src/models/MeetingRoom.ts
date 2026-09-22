import mongoose, { Schema } from "mongoose";
import type { IMeetingRoom } from "../types/index.js";

/**
 * A room that can be booked.
 *
 * Its own record rather than a string on the booking, because "Boardroom" typed
 * four different ways is four rooms as far as a clash check is concerned — and
 * a clash check that misses is the one bug this whole feature exists to avoid.
 */
const meetingRoomSchema = new Schema<IMeetingRoom>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    name: { type: String, required: [true, "Name is required"], trim: true, maxlength: 80 },
    location: { type: String, trim: true, maxlength: 120, default: "" },
    capacity: { type: Number, min: 0, default: 0 },
    /** Retired rather than deleted: past bookings still point at it. */
    active: { type: Boolean, default: true, index: true },
    notes: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true, versionKey: false }
);

meetingRoomSchema.index({ organization: 1, name: 1 }, { unique: true });

export const MeetingRoom = mongoose.model<IMeetingRoom>("MeetingRoom", meetingRoomSchema);
