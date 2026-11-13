import mongoose, { Schema } from "mongoose";
import type { IAdSpendSettings } from "../types/index.js";

/**
 * How one organisation tracks what its job ads cost: where it advertises, what
 * it means to spend a month, and from which week the log is owed.
 *
 * One per organisation. Absent until somebody saves it, and read as the
 * defaults until then (see adSpendService) — so a tenant that never advertises
 * is never reminded to log anything.
 */
const platformSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 40 },
    label: { type: String, required: true, trim: true, maxlength: 40 },
    active: { type: Boolean, default: true },
  },
  { _id: false }
);

const adSpendSettingsSchema = new Schema<IAdSpendSettings>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    currency: { type: String, trim: true, uppercase: true, maxlength: 3, default: "AED" },
    monthlyBudget: { type: Number, min: 0, max: 100_000_000, default: 0 },
    platforms: { type: [platformSchema], default: [] },
    trackingFrom: { type: String, default: null, match: /^\d{4}-\d{2}-\d{2}$/ },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

adSpendSettingsSchema.index({ organization: 1 }, { unique: true });

export const AdSpendSettings = mongoose.model<IAdSpendSettings>("AdSpendSettings", adSpendSettingsSchema);
