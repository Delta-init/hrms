import mongoose, { Schema } from "mongoose";

/**
 * One version of the DGO Points policy numbers. Never edited: a change is a new
 * version with the day it takes effect, so a month already counted keeps the
 * numbers it was counted with.
 */
const tierSchema = new Schema(
  {
    minCollections: { type: Number, required: true, min: 0 },
    everydayAed: { type: Number, required: true, min: 0 },
    eliteAed: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const dgoSettingsVersionSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    version: { type: Number, required: true, min: 1 },
    effectiveFrom: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    pointValueAed: { type: Number, required: true, min: 0.0001 },
    dailyCap: { type: Number, required: true, min: 0 },
    autoKpiCap: { type: Number, required: true, min: 0 },
    kpiExceededPct: { type: Number, required: true, min: 100 },
    expiryMonths: { type: Number, required: true, min: 1 },
    minRedemption: { type: Number, required: true, min: 0 },
    revenueSharePct: { type: Number, required: true, min: 0, max: 100 },
    tiers: { type: [tierSchema], required: true },
    note: { type: String, trim: true, maxlength: 300, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdByName: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

dgoSettingsVersionSchema.index({ organization: 1, version: 1 }, { unique: true });
dgoSettingsVersionSchema.index({ organization: 1, effectiveFrom: -1 });

export const DgoSettingsVersion = mongoose.model("DgoSettingsVersion", dgoSettingsVersionSchema);
