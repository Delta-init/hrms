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
 * gap between the two is exactly where a request gets forgotten. Approval
 * states are not here yet — they arrive with the finance handover, and the
 * field is a plain enum so they can be added without moving anything.
 */
const procurementSchema = new Schema<IProcurement>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
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
    status: {
      type: String,
      enum: ["requested", "ordered", "received", "cancelled"],
      default: "requested",
      index: true,
    },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, versionKey: false }
);

procurementSchema.index({ organization: 1, status: 1 });
procurementSchema.index({ organization: 1, createdAt: -1 });

export const Procurement = mongoose.model<IProcurement>("Procurement", procurementSchema);
