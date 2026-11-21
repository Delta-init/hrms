import mongoose, { Schema } from "mongoose";

/**
 * One batch of points from one credit, with its own expiry. Spending takes from
 * the lots that expire first; expiry takes what is left of a lot, never the part
 * reserved for a redemption in progress.
 */
const dgoPointLotSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    issued: { type: Number, required: true, min: 1 },
    remaining: { type: Number, required: true, min: 0 },
    reserved: { type: Number, default: 0, min: 0 },
    issuedOn: { type: String, required: true },
    expiresOn: { type: String, required: true },
    earningEvent: { type: Schema.Types.ObjectId, ref: "DgoEarningEvent", default: null },
    ruleCode: { type: String, default: null },
    description: { type: String, default: "" },
    /** Told the employee these points expire soon (30 and 7 days ahead), once each. */
    warned30: { type: Boolean, default: false },
    warned7: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

dgoPointLotSchema.index({ organization: 1, employee: 1, expiresOn: 1 });
dgoPointLotSchema.index({ earningEvent: 1 }, { unique: true, partialFilterExpression: { earningEvent: { $type: "objectId" } } });

export const DgoPointLot = mongoose.model("DgoPointLot", dgoPointLotSchema);
