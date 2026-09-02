import mongoose, { Schema } from "mongoose";

/**
 * A note that somebody has already been reminded, so they are not reminded again.
 *
 * The reminder job runs every few minutes — it has to, because a shift starts at
 * a different moment for everybody and there is no single time to check. Without
 * a record of what has been sent, somebody who forgets to clock in would receive
 * the same mail every few minutes until they did, which teaches them to filter
 * the sender and defeats the point.
 *
 * Kept here rather than on the attendance record because the commonest case has
 * no attendance record at all: forgetting to clock in leaves nothing behind to
 * write a flag on. Rows expire on their own after a fortnight — the question is
 * only ever "today", and a reminder ledger is not a history worth keeping.
 */
const punchReminderSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /** The person's own local day, "2026-09-01" — the same key attendance uses. */
    localDay: { type: String, required: true, maxlength: 10 },
    kind: { type: String, enum: ["missing_in", "missing_out"], required: true },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// One reminder of each kind, per person, per day. The unique index is the guard
// itself: two workers racing on the same minute cannot both get past it.
punchReminderSchema.index({ user: 1, localDay: 1, kind: 1 }, { unique: true });
punchReminderSchema.index({ sentAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 });

export const PunchReminder = mongoose.model("PunchReminder", punchReminderSchema);
