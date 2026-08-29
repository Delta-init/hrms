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
    /**
     * What kind of thing this is.
     *
     * An open list rather than a fixed one. The register runs to twenty kinds
     * today — mouse, keyboard, headphone, camera, uniform set — and a closed
     * enum meant most of them collapsing into "other" and becoming
     * indistinguishable. The app offers the known values and accepts a new one,
     * so the next kind of thing somebody buys does not need a developer.
     */
    category: { type: String, trim: true, maxlength: 40, default: "other", index: true },
    assetTag: { type: String, required: [true, "Asset tag is required"], trim: true, maxlength: 40 },
    serialNumber: { type: String, trim: true, maxlength: 80 },
    purchaseDate: { type: Date, default: null },
    purchaseCost: { type: Number, min: 0 },
    condition: { type: String, enum: ["new", "good", "fair", "poor", "damaged"], default: "new" },
    status: { type: String, enum: ["available", "assigned", "maintenance", "retired"], default: "available", index: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    assignedDate: { type: Date, default: null },
    /** Which office holds it — 410, 710, Hyatt. */
    branch: { type: String, trim: true, maxlength: 60, default: "", index: true },
    /** Where inside that office — "MD CABIN - 7th", "Meeting room 1", "General". */
    location: { type: String, trim: true, maxlength: 80, default: "" },
    /**
     * How many this record stands for. One, for anything with its own tag.
     *
     * Bulk stock is counted rather than tagged — thirty-five chairs with no
     * labels on them — and inventing thirty-five asset tags would produce
     * records nobody can match to a real chair.
     */
    quantity: { type: Number, min: 1, default: 1 },
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
