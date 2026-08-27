import mongoose, { Schema } from "mongoose";
import type { IOneTimeAdjustment } from "../types/index.js";

/** A one-off payment (bonus/arrears) or deduction (fine/recovery) applied to a
 *  single month's payslip. Consumed by the payroll run, then marked applied. */
const oneTimeAdjustmentSchema = new Schema<IOneTimeAdjustment>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: [true, "Employee is required"] },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    kind: { type: String, enum: ["payment", "deduction"], required: true },
    label: { type: String, required: [true, "Label is required"], trim: true, maxlength: 80 },
    amount: { type: Number, required: [true, "Amount is required"], min: 0 },
    /** Payout month it applies to (YYYY-MM). */
    month: { type: String, required: [true, "Month is required"], match: /^\d{4}-\d{2}$/ },
    notes: { type: String, trim: true, maxlength: 300 },
    /**
     * How much has actually been recovered so far. A deduction bigger than the
     * month's take-home is collected across several payslips rather than
     * pushing net pay negative, so "applied" is a threshold, not a flag flipped
     * on first sight.
     */
    appliedAmount: { type: Number, default: 0, min: 0 },
    applied: { type: Boolean, default: false },
    payslip: { type: Schema.Types.ObjectId, ref: "Payslip", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    /**
     * Who raised this — HR here, or the accounts department during their pass
     * over a submitted month.
     *
     * Kept because the two are not interchangeable to a person reading a
     * payslip: "Sales commission" added by finance is answerable to them, and
     * HR cannot edit or delete it while the month is with accounts.
     */
    source: { type: String, enum: ["hr", "finance"], default: "hr" },
    /**
     * The accounts-side id for this item, so the same addition arriving twice
     * updates one record rather than paying somebody twice. A retry after a
     * timeout is indistinguishable from a first attempt, so this is the only
     * thing making that safe.
     */
    externalId: { type: String, trim: true, default: null },
  },
  { timestamps: true, versionKey: false }
);

oneTimeAdjustmentSchema.index({ organization: 1, employee: 1, month: 1 });
// Sparse-unique: only finance-sourced rows carry one, and it must be theirs alone.
oneTimeAdjustmentSchema.index(
  { externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: "string" } } }
);

export const OneTimeAdjustment = mongoose.model<IOneTimeAdjustment>("OneTimeAdjustment", oneTimeAdjustmentSchema);
