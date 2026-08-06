import mongoose, { Schema } from "mongoose";
import type { IConsumedTicket } from "../types/index.js";

/**
 * Records impersonation restore tickets that have already been redeemed, so a
 * copy of one can't be replayed to mint further admin sessions. Rows expire
 * themselves once the ticket they guard would have expired anyway.
 */
const consumedTicketSchema = new Schema<IConsumedTicket>(
  {
    jti: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

consumedTicketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ConsumedTicket = mongoose.model<IConsumedTicket>("ConsumedTicket", consumedTicketSchema);
