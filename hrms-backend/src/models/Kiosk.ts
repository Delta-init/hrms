import mongoose, { Schema } from "mongoose";
import type { IKiosk } from "../types/index.js";

/**
 * A tablet running the face check-in screen.
 *
 * A kiosk has no user session — it is a shared device in a corridor, and
 * whoever walks up to it is identified by their face, not by signing in. So it
 * authenticates as itself, with a secret issued once at pairing and stored
 * here only as a hash. Deleting or deactivating the device is what revokes it.
 */
const kioskSchema = new Schema<IKiosk>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [80, "Name cannot exceed 80 characters"],
    },
    location: { type: String, trim: true, maxlength: 120 },
    tokenHash: { type: String, required: true, select: false },
    tokenHint: { type: String, required: true, trim: true, maxlength: 8 },
    active: { type: Boolean, default: true, index: true },
    // Written on every punch, so a device that has quietly stopped working is
    // visible in the list rather than discovered when someone complains.
    lastSeenAt: { type: Date, default: null },
    lastSeenIp: { type: String, default: null, trim: true, maxlength: 60 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, versionKey: false }
);

kioskSchema.index({ organization: 1, active: 1 });

export const Kiosk = mongoose.model<IKiosk>("Kiosk", kioskSchema);
