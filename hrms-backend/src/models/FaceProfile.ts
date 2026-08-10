import mongoose, { Schema } from "mongoose";
import type { IFaceProfile } from "../types/index.js";

/**
 * An employee's enrolled face, as embeddings rather than photographs.
 *
 * A face template is biometric personal data, so this model stores the least
 * that still works: the vectors recognition needs, one reference photo for
 * disputes, and a record of the consent that allows any of it. The enrollment
 * captures themselves are discarded once embedded — they are not needed again,
 * and a folder of staff photographs is a liability the vectors are not.
 */
const faceConsentSchema = new Schema(
  {
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { _id: false }
);

const faceProfileSchema = new Schema<IFaceProfile>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "User is required"],
      unique: true,
    },
    embeddings: {
      type: [[Number]],
      required: true,
      validate: {
        validator: (value: number[][]) =>
          value.length > 0 && value.every((v) => v.length === 512),
        message: "Each capture must be a 512-dimension embedding",
      },
      // Never returned by default. Nothing outside the recognition sync has any
      // business reading these, and a stray .populate() should not leak them.
      select: false,
    },
    modelPack: { type: String, required: true, trim: true, maxlength: 40 },
    referenceKey: { type: String, default: null, trim: true },
    consent: { type: faceConsentSchema, required: true },
    enrolledBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["active", "disabled"], default: "active", index: true },
  },
  { timestamps: true, versionKey: false }
);

// The gallery sync reads every active profile for one organization.
faceProfileSchema.index({ organization: 1, status: 1, updatedAt: -1 });

export const FaceProfile = mongoose.model<IFaceProfile>("FaceProfile", faceProfileSchema);
