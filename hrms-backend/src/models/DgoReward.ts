import mongoose, { Schema } from "mongoose";

/**
 * One thing in the DGO Points rewards store. Its price can change; every
 * redemption keeps the price, name and cost it was redeemed at, so a change
 * never touches a reward already asked for. Archived rewards leave both the
 * store and the catalogue but stay for the redemptions that point at them.
 */
const dgoRewardSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    category: { type: String, required: true, trim: true, maxlength: 40 },
    /** R2 key of its photo. */
    photoKey: { type: String, default: null },
    /** Price in points. */
    points: { type: Number, required: true, min: 1 },
    /** What the office pays for one, in fils (AED × 100); null when not known. */
    costFils: { type: Number, default: null, min: 0 },
    stockMode: { type: String, enum: ["unlimited", "limited"], default: "unlimited" },
    /** Left in stock when limited; taken by a conditional decrement when redeemed, given back when a redemption is cancelled. */
    stock: { type: Number, default: null, min: 0 },
    status: { type: String, enum: ["active", "hidden", "archived"], default: "active" },
    /** Bought for each redemption: HR's approval raises a purchase request that finance approves as an expense. */
    buyPerRedemption: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdByName: { type: String, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

dgoRewardSchema.index({ organization: 1, status: 1, points: 1 });

export const DgoReward = mongoose.model("DgoReward", dgoRewardSchema);
