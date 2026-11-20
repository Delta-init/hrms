import mongoose, { Schema } from "mongoose";

/**
 * The DGO Points ledger: the only record of what anybody holds.
 *
 * Insert-only. Every update and delete is refused at the model, so a posted row
 * cannot be changed by any code path; a correction is a new row (a reversal or
 * an adjustment) pointing at the one it corrects. Wallets are a cached sum of
 * these rows and can always be rebuilt from them.
 */
export const DGO_LEDGER_TYPES = ["credit", "reverse", "expire", "reserve", "release", "redeem", "adjust"] as const;

const dgoLedgerEntrySchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    /** Signed points: +30 a credit, −20 a reversal. A reserve moves available to reserved, so its delta is −points. */
    delta: { type: Number, required: true },
    type: { type: String, enum: DGO_LEDGER_TYPES, required: true },
    lot: { type: Schema.Types.ObjectId, ref: "DgoPointLot", default: null },
    earningEvent: { type: Schema.Types.ObjectId, ref: "DgoEarningEvent", default: null },
    ruleCode: { type: String, default: null },
    /** The day it counts on: the earning's day for a credit, today for anything else. */
    day: { type: String, required: true },
    month: { type: String, required: true },
    description: { type: String, required: true, maxlength: 300 },
    reversalOf: { type: Schema.Types.ObjectId, ref: "DgoLedgerEntry", default: null },
    idempotencyKey: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdByName: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

dgoLedgerEntrySchema.index({ idempotencyKey: 1 }, { unique: true });
dgoLedgerEntrySchema.index({ organization: 1, employee: 1, createdAt: -1 });
dgoLedgerEntrySchema.index({ organization: 1, month: 1, type: 1 });

const refuse = () => {
  throw Object.assign(new Error("DGO ledger rows are never changed or deleted — post a reversal instead"), { statusCode: 409 });
};
dgoLedgerEntrySchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne", "deleteMany", "findOneAndDelete"],
  refuse
);
dgoLedgerEntrySchema.pre("deleteOne", { document: true, query: true }, refuse);
dgoLedgerEntrySchema.pre("save", function () {
  if (!this.isNew) refuse();
});

export const DgoLedgerEntry = mongoose.model("DgoLedgerEntry", dgoLedgerEntrySchema);
