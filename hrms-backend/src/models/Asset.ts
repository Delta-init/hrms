import mongoose, { Schema } from "mongoose";
import type { IAsset } from "../types/index.js";

/** One issue/return/maintenance/retirement event in an asset's lifecycle. */
const assetHistorySchema = new Schema(
  {
    action: { type: String, enum: ["issued", "returned", "sent_to_maintenance", "retired"], required: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    date: { type: Date, required: true },
    condition: { type: String, enum: ["new", "good", "fair", "poor", "damaged"], default: undefined },
    notes: { type: String, trim: true, maxlength: 300 },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false, timestamps: false }
);

/** A company asset (laptop, phone, furniture, ...) tracked from purchase
 *  through issue/return cycles to retirement. */
const assetSchema = new Schema<IAsset>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    name: { type: String, required: [true, "Name is required"], trim: true, maxlength: 120 },
    category: {
      type: String,
      enum: ["laptop", "phone", "monitor", "furniture", "vehicle", "sim_card", "other"],
      default: "other",
    },
    assetTag: { type: String, required: [true, "Asset tag is required"], trim: true, maxlength: 40 },
    serialNumber: { type: String, trim: true, maxlength: 80 },
    purchaseDate: { type: Date, default: null },
    purchaseCost: { type: Number, min: 0 },
    condition: { type: String, enum: ["new", "good", "fair", "poor", "damaged"], default: "new" },
    status: { type: String, enum: ["available", "assigned", "maintenance", "retired"], default: "available", index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    assignedDate: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 500 },
    history: { type: [assetHistorySchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

assetSchema.index({ organization: 1, assetTag: 1 }, { unique: true });
assetSchema.index({ organization: 1, status: 1 });
assetSchema.index({ organization: 1, assignedTo: 1 });

export const Asset = mongoose.model<IAsset>("Asset", assetSchema);
