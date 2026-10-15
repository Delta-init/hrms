import mongoose, { Schema } from "mongoose";
import type { IOfferMail } from "../types/index.js";

/**
 * The thread behind an offer: what HR sent, what came back, and any signed
 * copy uploaded by hand. Files live in storage; this keeps their keys.
 *
 * `messageId` is unique per organisation so the inbox reader, which looks at
 * the same messages more than once, stores each reply once.
 */
const offerMailSchema = new Schema<IOfferMail>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    application: { type: Schema.Types.ObjectId, ref: "Application", required: true, index: true },
    candidate: { type: Schema.Types.ObjectId, ref: "Candidate", required: true },
    direction: { type: String, enum: ["out", "in"], required: true },
    source: { type: String, enum: ["email", "upload"], default: "email" },
    subject: { type: String, trim: true, maxlength: 300 },
    from: { type: String, trim: true, maxlength: 300 },
    to: { type: [String], default: [] },
    text: { type: String, maxlength: 20000 },
    messageId: { type: String, trim: true, default: null },
    inReplyTo: { type: String, trim: true, default: null },
    attachments: {
      type: [new Schema({
        key: { type: String, required: true },
        fileName: { type: String, trim: true, maxlength: 260 },
        contentType: { type: String, trim: true, maxlength: 120 },
        size: { type: Number, min: 0 },
      }, { _id: false })],
      default: [],
    },
    sentBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    at: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false }
);

offerMailSchema.index(
  { organization: 1, messageId: 1 },
  { unique: true, partialFilterExpression: { messageId: { $type: "string" } } }
);

export const OfferMail = mongoose.model<IOfferMail>("OfferMail", offerMailSchema);
