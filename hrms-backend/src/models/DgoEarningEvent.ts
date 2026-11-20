import mongoose, { Schema } from "mongoose";

/**
 * One reason somebody is owed points: a KPI day, an award, an innovation.
 *
 * It carries its own approval chain and trail. Points reach the wallet only when
 * the last step approves (or at once, for a rule with no chain), through a
 * ledger credit keyed on this event, so approving twice or a source sending the
 * same thing twice can never pay twice: `idempotencyKey` is unique.
 *
 * Status: pending → posted, or rejected; capped (over the daily cap) and
 * budget_blocked (department allowance used up) are held, never paid;
 * superseded (a KPI met replaced by KPI exceeded); reversed (a posted award
 * taken back by a reversal entry).
 */
const trailSchema = new Schema(
  {
    stage: { type: String, enum: ["head", "hr", "finance", null], default: null },
    action: { type: String, required: true },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    byName: { type: String, default: null },
    note: { type: String, trim: true, maxlength: 1000, default: null },
    at: { type: Date, required: true },
  },
  { _id: false }
);

const dgoEarningEventSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    employeeName: { type: String, required: true },
    /** The department on the day — moving department later leaves this, and its budget, where it was. */
    department: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    departmentName: { type: String, default: null },
    rule: { type: Schema.Types.ObjectId, ref: "DgoEarningRule", required: true },
    ruleCode: { type: String, required: true },
    ruleVersion: { type: Number, required: true },
    ruleName: { type: String, required: true },
    source: { type: String, enum: ["kpi", "award"], required: true },
    kpiKey: { type: String, default: null },
    kpiLevel: { type: String, enum: ["met", "exceeded", null], default: null },
    points: { type: Number, required: true, min: 1 },
    valueFils: { type: Number, required: true, min: 0 },
    capExempt: { type: Boolean, default: false },
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    reason: { type: String, trim: true, maxlength: 1000, required: true },
    evidenceNote: { type: String, trim: true, maxlength: 2000, default: null },
    status: {
      type: String,
      enum: ["pending", "posted", "rejected", "capped", "budget_blocked", "superseded", "reversed"],
      required: true,
    },
    chain: { type: [{ type: String, enum: ["head", "hr", "finance"] }], default: [] },
    stage: { type: String, enum: ["head", "hr", "finance", null], default: null },
    trail: { type: [trailSchema], default: [] },
    submittedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    submittedByName: { type: String, default: null },
    idempotencyKey: { type: String, required: true },
    lot: { type: Schema.Types.ObjectId, ref: "DgoPointLot", default: null },
    postedAt: { type: Date, default: null },
    supersedes: { type: Schema.Types.ObjectId, ref: "DgoEarningEvent", default: null },
    reversedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

dgoEarningEventSchema.index({ idempotencyKey: 1 }, { unique: true });
dgoEarningEventSchema.index({ organization: 1, employee: 1, day: 1 });
dgoEarningEventSchema.index({ organization: 1, status: 1, stage: 1 });
dgoEarningEventSchema.index({ organization: 1, month: 1, status: 1 });
dgoEarningEventSchema.index({ "trail.by": 1 });

export const DgoEarningEvent = mongoose.model("DgoEarningEvent", dgoEarningEventSchema);
