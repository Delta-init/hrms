import mongoose, { Schema } from "mongoose";

/**
 * One version of an earning rule (KPI_MET, INNOVATION…). Never edited: a change,
 * switching it off included, is a new version from a given day. An earning keeps
 * the version it was awarded under.
 */
const dgoEarningRuleSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    code: { type: String, required: true, uppercase: true, trim: true, match: /^[A-Z][A-Z0-9_]{1,39}$/ },
    version: { type: Number, required: true, min: 1 },
    effectiveFrom: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 300, default: "" },
    points: { type: Number, required: true, min: 1, max: 100000 },
    kind: { type: String, enum: ["performance", "recognition"], default: "recognition" },
    /** "kpi": one per person, KPI and day, met or exceeded. "award": anything else, approved through its chain. */
    source: { type: String, enum: ["kpi", "award"], default: "award" },
    kpiLevel: { type: String, enum: ["met", "exceeded", null], default: null },
    needsEvidence: { type: Boolean, default: false },
    /** Who approves, in order. Empty: posted as soon as a head or HR records it. */
    chain: { type: [{ type: String, enum: ["head", "hr", "finance"] }], default: [] },
    /** Outside the daily cap (innovation). Never outside the budget. */
    capExempt: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdByName: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

dgoEarningRuleSchema.index({ organization: 1, code: 1, version: 1 }, { unique: true });

export const DgoEarningRule = mongoose.model("DgoEarningRule", dgoEarningRuleSchema);
