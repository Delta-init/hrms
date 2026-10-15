import mongoose, { Schema } from "mongoose";
import type { IOfferEmailTemplate } from "../types/index.js";

/**
 * The email an offer goes out in — not the letter, which is a LetterTemplate
 * attached as a PDF. Same {{tokens}} as the letter, so one set of words covers
 * both.
 */
const offerEmailTemplateSchema = new Schema<IOfferEmailTemplate>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    name: { type: String, required: [true, "Name is required"], trim: true, maxlength: 120 },
    subject: { type: String, required: [true, "Subject is required"], trim: true, maxlength: 200 },
    body: { type: String, required: [true, "Body is required"], maxlength: 10000 },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

offerEmailTemplateSchema.index({ organization: 1, name: 1 }, { unique: true });

export const OfferEmailTemplate = mongoose.model<IOfferEmailTemplate>("OfferEmailTemplate", offerEmailTemplateSchema);
