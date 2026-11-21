import mongoose, { Schema } from "mongoose";

/**
 * A department's share of one month's everyday pool, and how much of it awards
 * have taken. `committedFils` only ever moves by a conditional increment that
 * refuses to pass `allocationFils`, so two approvals at once cannot overspend it.
 * `department: null` is the bucket for people with no department.
 */
const dgoDepartmentBudgetSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    period: { type: Schema.Types.ObjectId, ref: "DgoBudgetPeriod", required: true },
    month: { type: String, required: true },
    department: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    departmentName: { type: String, required: true },
    group: { type: String, enum: ["revenue", "other"], required: true },
    headcount: { type: Number, default: 0 },
    allocationFils: { type: Number, default: 0, min: 0 },
    committedFils: { type: Number, default: 0, min: 0 },
    /** An approved override of the allowance (two finance people): kept when allowances are recounted. */
    overrideFils: { type: Number, default: null, min: 0 },
  },
  { timestamps: true, versionKey: false }
);

dgoDepartmentBudgetSchema.index({ period: 1, department: 1 }, { unique: true });

export const DgoDepartmentBudget = mongoose.model("DgoDepartmentBudget", dgoDepartmentBudgetSchema);
