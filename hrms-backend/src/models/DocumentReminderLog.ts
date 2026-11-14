import mongoose, { Schema } from "mongoose";

/**
 * Which document-expiry reminders have gone out, so none goes out twice.
 *
 * `subject` is the employee — or, for a company document, the document itself.
 * `doc` names which of their documents ("visa", "labourCard", "other:<id>",
 * "company"). The expiry date is part of the key: once a renewed date is
 * entered, its countdown starts with nothing sent. The unique index is what
 * makes a second run on the same day send nothing — the entry is written
 * before anything is sent, and only one write can win.
 */
const documentReminderLogSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    subject: { type: Schema.Types.ObjectId, required: true },
    doc: { type: String, required: true },
    expiryDay: { type: String, required: true },
    key: { type: String, required: true },
    sentAt: { type: Date, required: true },
  },
  { versionKey: false }
);

documentReminderLogSchema.index({ subject: 1, doc: 1, expiryDay: 1, key: 1 }, { unique: true });

export const DocumentReminderLog = mongoose.model("DocumentReminderLog", documentReminderLogSchema);
