import mongoose, { Schema } from "mongoose";

/**
 * A document expiry somebody has decided not to chase.
 *
 * The documents view generates its rows from the requirement matrix rather than
 * reading them from storage, so there is nothing on the row itself to mark. A
 * leaver's visa, a passport already renewed under a new number, a certificate
 * that expired years ago and never mattered — each is a real row that will keep
 * being counted as a problem forever, and the count is the thing people act on.
 *
 * So the dismissal is stored beside the row rather than on it, keyed by the two
 * things that identify one: who it belongs to, and which slot it fills. Slots
 * are the requirement keys ("passport", "visa_copy") or `other:<id>` for a
 * free-form entry, which is exactly what the view already calls them.
 *
 * Deliberately not a deletion. The row stays visible under its own status so it
 * can be found and reinstated; only the counts stop including it.
 */
const documentIgnoreSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    /** Requirement key, or `other:<id>` for a free-form entry. */
    slot: { type: String, required: true, trim: true, maxlength: 80 },
    /** Why it is not worth chasing — shown back to whoever reviews the list. */
    reason: { type: String, trim: true, maxlength: 200, default: "" },
    ignoredBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    ignoredAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false }
);

// One row, one decision. Ignoring something already ignored updates the reason
// rather than stacking duplicates that would each have to be undone.
documentIgnoreSchema.index({ organization: 1, employee: 1, slot: 1 }, { unique: true });

export const DocumentIgnore = mongoose.model("DocumentIgnore", documentIgnoreSchema);
