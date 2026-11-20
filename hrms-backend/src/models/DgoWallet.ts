import mongoose, { Schema } from "mongoose";

/**
 * One employee's DGO Points balances: a cached sum of the ledger, kept for fast
 * reads. The ledger wins any disagreement; `rebuildWallet` recomputes this.
 */
const dgoWalletSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    available: { type: Number, default: 0 },
    reserved: { type: Number, default: 0 },
    lifetimeEarned: { type: Number, default: 0 },
    redeemed: { type: Number, default: 0 },
    expired: { type: Number, default: 0 },
    reversed: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false }
);

dgoWalletSchema.index({ employee: 1 }, { unique: true });

export const DgoWallet = mongoose.model("DgoWallet", dgoWalletSchema);
