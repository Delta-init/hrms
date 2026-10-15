import mongoose, { Schema } from "mongoose";

/**
 * How far the offer-inbox reader has got in one organisation's mailbox: the
 * last message it looked at, by IMAP UID. A new `uidValidity` means the server
 * renumbered the mailbox, and the reader starts again from a few days back.
 */
const mailboxCursorSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", required: true },
    mailbox: { type: String, required: true, default: "INBOX" },
    uidValidity: { type: String, default: null },
    lastUid: { type: Number, default: 0 },
    lastCheckedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    lastErrorAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

mailboxCursorSchema.index({ organization: 1, mailbox: 1 }, { unique: true });

export const MailboxCursor = mongoose.model("MailboxCursor", mailboxCursorSchema);
