import mongoose, { Schema } from "mongoose";

/**
 * A different allowance for one department in one month, proposed by one
 * finance person and approved by another. Approved, it is written onto the
 * department's row as `overrideFils`, which recounting the allowances keeps.
 */
const dgoBudgetOverrideSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    department: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    departmentName: { type: String, required: true },
    fromFils: { type: Number, required: true, min: 0 },
    toFils: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    proposedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    proposedByName: { type: String, default: null },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedByName: { type: String, default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, maxlength: 500, default: null },
    idempotencyKey: { type: String, required: true },
  },
  { timestamps: true, versionKey: false }
);

dgoBudgetOverrideSchema.index({ idempotencyKey: 1 }, { unique: true });
dgoBudgetOverrideSchema.index({ organization: 1, month: 1, status: 1 });

export const DgoBudgetOverride = mongoose.model("DgoBudgetOverride", dgoBudgetOverrideSchema);
