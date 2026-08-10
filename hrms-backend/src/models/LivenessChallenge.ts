import mongoose, { Schema } from "mongoose";
import type { ILivenessChallenge } from "../types/index.js";

/**
 * A one-shot instruction to prove somebody is actually standing at the kiosk.
 *
 * Kept in the database rather than in process memory so it survives a restart
 * and holds regardless of how many API processes are running — a challenge that
 * one worker issued and another can't see would fail honest people at random.
 *
 * Rows expire themselves shortly after the challenge does, so this collection
 * stays small without a sweeper.
 */
const livenessChallengeSchema = new Schema<ILivenessChallenge>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    // Bound to the device it was issued to: a challenge obtained from one
    // kiosk cannot be redeemed at another.
    kiosk: { type: Schema.Types.ObjectId, ref: "Kiosk", required: true, index: true },
    steps: { type: [String], required: true },
    expiresAt: { type: Date, required: true },
    // Stamped the moment it is redeemed, whatever the outcome. A challenge that
    // could be retried would let an attacker keep sampling frames against the
    // same prompts until one got through.
    consumedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

livenessChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 });

export const LivenessChallenge = mongoose.model<ILivenessChallenge>(
  "LivenessChallenge",
  livenessChallengeSchema
);
