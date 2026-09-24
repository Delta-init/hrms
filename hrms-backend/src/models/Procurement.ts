import mongoose, { Schema } from "mongoose";
import type { IProcurement } from "../types/index.js";

/**
 * Something the company needs bought.
 *
 * Kept apart from Asset deliberately, even though it sits on the same page and
 * most of it ends up as one. An asset is a thing the company owns and can
 * issue to somebody; this is a request made before the thing exists, and the
 * two answer different questions — "who has the laptop" against "did we ever
 * decide to buy one". Folding them together would mean inventing an asset with
 * no tag, no serial number and nobody holding it, which every asset screen
 * would then have to learn to ignore.
 *
 * The status runs to `received` rather than stopping at ordered, because the
 * gap between the two is exactly where a request gets forgotten.
 *
 * Two kinds share the record. An `existing` one is a note of something the
 * company already bought — it is history, and asking finance to approve a
 * purchase already made would be theatre. A `new` one is a request for a
 * decision, and only it walks the approval states. Keeping them in one
 * collection means one list, one search and one export; separating them by a
 * field rather than a table means the difference is visible in every query
 * that cares and invisible in every query that does not.
 */
const procurementSchema = new Schema<IProcurement>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    /**
     * `existing` is already bought and needs nobody's permission; `new` is a
     * request, and the only kind the approval states apply to.
     */
    kind: { type: String, enum: ["existing", "new"], default: "existing", index: true },
    item: { type: String, required: [true, "Item is required"], trim: true, maxlength: 160 },
    category: { type: String, trim: true, maxlength: 40, default: "other", index: true },
    quantity: { type: Number, min: 1, default: 1 },
    /**
     * What it is expected to cost, for the whole quantity.
     *
     * An estimate on purpose: whoever raises this is asking for a decision, not
     * quoting a price. The real figure comes from the vendor later, and writing
     * it here as though it were settled invites somebody to treat it as one.
     */
    estimatedCost: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "AED", uppercase: true, trim: true, maxlength: 6 },
    /**
     * Free text, not a reference. The vendor master lives in the finance
     * system, and half of these are raised before anyone has chosen a supplier
     * — so this is a suggestion, and finance picks the real one.
     */
    vendor: { type: String, trim: true, maxlength: 120, default: "" },
    department: { type: Schema.Types.ObjectId, ref: "Department", default: null, index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    neededBy: { type: Date, default: null },
    justification: { type: String, trim: true, maxlength: 1000 },
    /**
     * Where it has got to.
     *
     * `hr_approved` is the one finance watches for: HR has agreed it is worth
     * buying, and the money question is now somebody else's. `approved` means
     * finance has signed it off and a draft purchase order exists on their
     * side. An `existing` record skips straight to `ordered` or `received`.
     */
    status: {
      type: String,
      enum: ["requested", "hr_approved", "approved", "rejected", "ordered", "received", "cancelled"],
      default: "requested",
      index: true,
    },

    // ── Decisions ──
    hrReviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    hrReviewedAt: { type: Date, default: null },
    hrNote: { type: String, trim: true, maxlength: 500 },
    /** Finance has no login here, so the decision is recorded, not attributed. */
    financeReviewedAt: { type: Date, default: null },
    financeNote: { type: String, trim: true, maxlength: 500 },
    /** The purchase order finance raised against it, for anyone chasing later. */
    purchaseOrderRef: { type: String, trim: true, maxlength: 60, default: "" },
    /** Which side said no, so a rejected request explains itself. */
    rejectedBy: { type: String, enum: ["hr", "finance", null], default: null },
    /**
     * How many times this has come back for another try.
     *
     * Kept because a request on its fourth attempt is a different conversation
     * from one on its first, and the decision trail is otherwise overwritten
     * each time somebody revises and resubmits.
     */
    resubmitCount: { type: Number, default: 0, min: 0 },

    notes: { type: String, trim: true, maxlength: 500 },

    // A quote, a spec sheet, a photo of the broken thing — whatever backs the
    // request up. Attached by the requester or their department head, same as
    // editing the request itself.
    reportKey: { type: String, trim: true, default: "" },
    reportFileName: { type: String, trim: true, maxlength: 200, default: "" },
  },
  { timestamps: true, versionKey: false }
);

procurementSchema.index({ organization: 1, status: 1 });
procurementSchema.index({ organization: 1, createdAt: -1 });

export const Procurement = mongoose.model<IProcurement>("Procurement", procurementSchema);
