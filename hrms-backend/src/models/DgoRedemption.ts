import mongoose, { Schema } from "mongoose";

/**
 * An employee spending points on a reward.
 *
 * reserved → approved → fulfilled, or cancelled (the employee, while reserved) /
 * rejected (HR, before it is delivered). Asking reserves the points at once, in
 * one step that can't take the wallet below zero; a cancel or rejection gives
 * them back exactly once (a ledger row keyed on this redemption); delivery spends
 * them. `lots` says which batches of points are held, earliest expiry first.
 */
const trailSchema = new Schema(
  {
    action: { type: String, required: true },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    byName: { type: String, default: null },
    note: { type: String, trim: true, maxlength: 1000, default: null },
    at: { type: Date, required: true },
  },
  { _id: false }
);

const dgoRedemptionSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    employeeName: { type: String, required: true },
    departmentName: { type: String, default: null },
    reward: { type: Schema.Types.ObjectId, ref: "DgoReward", required: true },
    rewardName: { type: String, required: true },
    rewardCategory: { type: String, default: "" },
    photoKey: { type: String, default: null },
    /** The price when asked for, in points, and what the office pays for one then. */
    points: { type: Number, required: true, min: 1 },
    costFils: { type: Number, default: null },
    /** Took one from a limited stock, so a cancel gives it back. */
    tookStock: { type: Boolean, default: false },
    /** "reserving" only while the reserve is in progress; a failed attempt is removed. */
    status: { type: String, enum: ["reserving", "reserved", "approved", "fulfilled", "cancelled", "rejected"], required: true },
    lots: { type: [{ _id: false, lot: { type: Schema.Types.ObjectId, ref: "DgoPointLot" }, points: Number }], default: [] },
    note: { type: String, trim: true, maxlength: 500, default: null },
    fulfilmentNote: { type: String, trim: true, maxlength: 500, default: null },
    trail: { type: [trailSchema], default: [] },
    idempotencyKey: { type: String, required: true },
    fulfilledAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

dgoRedemptionSchema.index({ idempotencyKey: 1 }, { unique: true });
dgoRedemptionSchema.index({ organization: 1, status: 1, createdAt: -1 });
dgoRedemptionSchema.index({ organization: 1, employee: 1, createdAt: -1 });
dgoRedemptionSchema.index({ reward: 1 });

export const DgoRedemption = mongoose.model("DgoRedemption", dgoRedemptionSchema);
