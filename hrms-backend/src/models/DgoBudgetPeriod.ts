import mongoose, { Schema } from "mongoose";

/**
 * One month of DGO Points money for an organisation: its tier, the everyday and
 * elite pools, and finance's eligible-collections figure (entered by one person,
 * confirmed by another). Amounts are fils (AED × 100).
 */
const historySchema = new Schema(
  {
    action: { type: String, required: true },
    amountFils: { type: Number, default: null },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    byName: { type: String, default: null },
    note: { type: String, default: null },
    at: { type: Date, required: true },
  },
  { _id: false }
);

const dgoBudgetPeriodSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    status: { type: String, enum: ["open", "review", "finance_approved", "closed"], default: "open" },
    settingsVersion: { type: Number, required: true },
    pointValueAed: { type: Number, required: true },
    revenueSharePct: { type: Number, required: true },
    tiers: { type: [{ _id: false, minCollections: Number, everydayAed: Number, eliteAed: Number }], default: [] },
    tierIndex: { type: Number, required: true },
    /** What set the tier: this month's confirmed figure, last month's, or nothing yet (lowest tier). */
    tierBasis: { type: String, enum: ["confirmed", "previous_month", "lowest"], required: true },
    tierBasisMonth: { type: String, default: null },
    everydayFils: { type: Number, required: true, min: 0 },
    eliteFils: { type: Number, required: true, min: 0 },
    /** Monthly achiever prizes paid from the elite pool; only moves by a conditional increment, so it can't pass eliteFils. */
    eliteCommittedFils: { type: Number, default: 0, min: 0 },
    /** The revenue/other grouping this month runs on, copied from the program when it opened. */
    revenueDepartments: { type: [{ type: Schema.Types.ObjectId, ref: "Department" }], default: [] },
    collections: {
      enteredFils: { type: Number, default: null },
      enteredBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      enteredByName: { type: String, default: null },
      enteredAt: { type: Date, default: null },
      note: { type: String, default: null },
      confirmedFils: { type: Number, default: null },
      confirmedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      confirmedByName: { type: String, default: null },
      confirmedAt: { type: Date, default: null },
    },
    history: { type: [historySchema], default: [] },
    closedAt: { type: Date, default: null },
    closedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

dgoBudgetPeriodSchema.index({ organization: 1, month: 1 }, { unique: true });

export const DgoBudgetPeriod = mongoose.model("DgoBudgetPeriod", dgoBudgetPeriodSchema);
