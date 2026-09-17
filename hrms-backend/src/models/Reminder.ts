import mongoose, { Schema } from "mongoose";
import type { IReminder } from "../types/index.js";

/**
 * A one-off reminder, aimed at everyone in the org, the creator's own
 * department, or just the creator.
 *
 * `time` is deliberately optional: a reminder with one fires three times as
 * the moment approaches (30 minutes before, 5 minutes before, and at the
 * moment itself); a date-only reminder instead sends one email the evening
 * before, the same convention the holiday reminder already uses. `firedStages`
 * is the ledger that keeps the polling job from repeating a stage it already
 * sent — see reminderJob.ts.
 */
const reminderSchema = new Schema<IReminder>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: [true, "Title is required"], trim: true, maxlength: 150 },
    message: { type: String, trim: true, maxlength: 1000 },
    audience: { type: String, enum: ["everyone", "team", "self"], required: true },
    // Set only for a "team" reminder — the creator's own department at the
    // moment they created it. A later department move doesn't retarget an
    // already-scheduled reminder.
    department: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    date: { type: Date, required: [true, "Date is required"] },
    // "HH:MM" in `timeZone`, or null for a date-only reminder.
    time: { type: String, default: null },
    timeZone: { type: String, default: "Asia/Dubai" },
    status: { type: String, enum: ["scheduled", "sent", "cancelled"], default: "scheduled" },
    firedStages: { type: [String], default: [] },
  },
  { timestamps: true, versionKey: false }
);

reminderSchema.index({ organization: 1, status: 1, date: 1 });

export const Reminder = mongoose.model<IReminder>("Reminder", reminderSchema);
