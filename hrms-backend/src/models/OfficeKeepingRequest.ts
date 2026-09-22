import mongoose, { Schema } from "mongoose";
import type { IOfficeKeepingRequest } from "../types/index.js";

/**
 * Every move a request made, and who made it.
 *
 * Kept as a trail rather than a pair of timestamps because "when was this
 * sorted" and "when did somebody say they were on their way" are the two
 * questions asked about a request afterwards, and a status field alone answers
 * neither once it has moved on.
 */
const stepSchema = new Schema(
  {
    status: { type: String, required: true },
    at: { type: Date, default: Date.now },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    note: { type: String, trim: true, maxlength: 300 },
  },
  { _id: false }
);

/**
 * Something in the office that needs seeing to.
 *
 * Open to everybody, because the person who notices a broken chair is whoever
 * sat in it — there is no approval to pass and nothing to authorise, only
 * somebody to tell. What is gated is the other side: moving a request along is
 * for whoever runs office keeping.
 *
 * The photo is optional on purpose. Made compulsory it would stop a request
 * being raised at all from a desk phone with a dead camera, and a described
 * problem reported is worth more than a photographed one that never was.
 */
const officeKeepingSchema = new Schema<IOfficeKeepingRequest>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    issue: { type: String, required: [true, "Tell us what needs doing"], trim: true, maxlength: 1000 },
    /** Free text: "third floor kitchen" finds the place faster than a code. */
    location: { type: String, required: [true, "Where is it?"], trim: true, maxlength: 160 },
    /** Storage key, not a URL — the public address is derived when read. */
    photoKey: { type: String, trim: true, default: "" },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: {
      type: String,
      enum: ["requested", "arriving", "sorted", "cancelled"],
      default: "requested",
      index: true,
    },
    /** Whoever last moved it — office keeping, or HR covering for them. */
    handledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    history: { type: [stepSchema], default: [] },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, versionKey: false }
);

officeKeepingSchema.index({ organization: 1, status: 1, createdAt: -1 });

export const OfficeKeepingRequest = mongoose.model<IOfficeKeepingRequest>("OfficeKeepingRequest", officeKeepingSchema);
