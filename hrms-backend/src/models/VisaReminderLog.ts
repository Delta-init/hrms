import mongoose, { Schema } from "mongoose";

/**
 * Which visa reminders have gone out, so none goes out twice.
 *
 * Keyed by the expiry date the reminder was about as well as the reminder
 * itself ("before-15", "day", "after-3"): once HR approves a new visa its
 * date is different, and its countdown starts with nothing sent. The unique
 * index is what makes a second run on the same day send nothing — the entry
 * is written before anything is sent, and only one write can win.
 */
const visaReminderLogSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    expiryDay: { type: String, required: true },
    key: { type: String, required: true },
    sentAt: { type: Date, required: true },
  },
  { versionKey: false }
);

visaReminderLogSchema.index({ employee: 1, expiryDay: 1, key: 1 }, { unique: true });

export const VisaReminderLog = mongoose.model("VisaReminderLog", visaReminderLogSchema);
