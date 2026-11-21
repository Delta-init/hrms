import mongoose, { Schema } from "mongoose";

/**
 * A manual correction of somebody's points, proposed by one finance person and
 * approved by another (maker-checker). Approval posts one `adjust` ledger row
 * keyed on this document, so it lands once. It sits outside the department
 * allowances: the month's totals show adjustments on their own line.
 */
const dgoAdjustmentSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    employeeName: { type: String, required: true },
    departmentName: { type: String, default: null },
    /** Signed: +50 adds, −50 removes. */
    points: { type: Number, required: true },
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

dgoAdjustmentSchema.index({ idempotencyKey: 1 }, { unique: true });
dgoAdjustmentSchema.index({ organization: 1, status: 1, createdAt: -1 });

export const DgoAdjustment = mongoose.model("DgoAdjustment", dgoAdjustmentSchema);
