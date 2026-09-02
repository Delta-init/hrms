import mongoose, { Schema } from "mongoose";

/**
 * Something that happened, said to one person inside the app.
 *
 * Email already carries the same events, and deliberately still does — people
 * read mail when they are not in the app, which is most of the day. This is the
 * other half: a decision that arrives while somebody is working should not
 * require them to check another program to find out about it.
 *
 * One row per recipient rather than one row with a list of them. It costs more
 * rows and makes "who has read this" a field rather than a subdocument scan,
 * which is the operation that actually happens on every page load.
 *
 * Rows expire after sixty days. A notification is a nudge with a short useful
 * life, not a record — the leave request, the attendance row and the approval
 * trail are the records, and they are kept properly elsewhere.
 */
const notificationSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    /** Who sees it. */
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /**
     * What kind of thing happened, for the icon and the grouping.
     *
     * Coarse on purpose: the title carries the specifics, and a taxonomy fine
     * enough to describe every event is one nobody keeps up to date.
     */
    kind: {
      type: String,
      enum: ["leave", "regularization", "approval", "announcement", "payroll", "system"],
      default: "system",
    },
    /** Approved, rejected, or simply something to know about. */
    tone: { type: String, enum: ["positive", "negative", "neutral"], default: "neutral" },
    title: { type: String, required: true, maxlength: 200 },
    body: { type: String, default: "", maxlength: 500 },
    /** Where clicking it goes. */
    href: { type: String, default: "" },
    /**
     * Who caused it, when that is a person.
     *
     * Kept so a notification can say "Riswana approved your leave" rather than
     * "your leave was approved" — the passive voice is the reason people ask
     * who did it, which is a question the row already knows the answer to.
     */
    actor: { type: Schema.Types.ObjectId, ref: "User", default: null },
    readAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// The one query that runs on every page load: this person's newest first.
notificationSchema.index({ user: 1, createdAt: -1 });
// And the badge, which asks only for the unread ones.
notificationSchema.index({ user: 1, readAt: 1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 });

export const Notification = mongoose.model("Notification", notificationSchema);
