import mongoose, { Schema } from "mongoose";
import type { IInterview } from "../types/index.js";

/**
 * One scheduled conversation with a candidate.
 *
 * `recordingLink` is a URL and nothing more. Recordings are large enough to
 * need an upload path this codebase does not have, and recording somebody
 * without consent is unlawful in most places this runs — so the file lives
 * wherever the meeting tool put it, and this holds the pointer.
 */
const interviewSchema = new Schema<IInterview>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
    application: { type: Schema.Types.ObjectId, ref: "Application", required: true, index: true },

    round: { type: Number, default: 1, min: 1, max: 20 },
    title: { type: String, trim: true, maxlength: 120 },
    mode: { type: String, enum: ["in_person", "video", "phone"], default: "video" },

    scheduledAt: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, default: 60, min: 5, max: 600 },
    timeZone: { type: String, trim: true, default: "Asia/Dubai" },
    location: { type: String, trim: true, maxlength: 200 },
    meetingLink: { type: String, trim: true, maxlength: 500 },
    recordingLink: { type: String, trim: true, maxlength: 500 },

    panel: [{ type: Schema.Types.ObjectId, ref: "User" }],
    status: { type: String, enum: ["scheduled", "completed", "no_show", "cancelled"], default: "scheduled", index: true },
    notes: { type: String, trim: true, maxlength: 2000 },

    inviteSequence: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

interviewSchema.index({ organization: 1, scheduledAt: 1, status: 1 });

export const Interview = mongoose.model<IInterview>("Interview", interviewSchema);
