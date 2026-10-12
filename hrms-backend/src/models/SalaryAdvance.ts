import mongoose, { Schema } from "mongoose";
import type { ISalaryAdvance } from "../types/index.js";

/**
 * An employee asking to be paid part of their salary early.
 *
 * Two decisions, in order: HR agrees and sets how it is recovered (how many
 * payslips, from which month), then finance — in the finance system, over the
 * integration API — pays it out. Only then does it become money owed: a loan
 * of kind "advance" that payroll recovers like any other, printed on the
 * payslip as "Salary advance".
 *
 * The salary it was checked against is kept, so a request decided weeks later
 * still shows what the limit was when it was asked.
 */
const salaryAdvanceSchema = new Schema<ISalaryAdvance>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "AED", uppercase: true, trim: true, maxlength: 6 },
    reason: { type: String, required: [true, "A reason is required"], trim: true, maxlength: 500 },
    neededBy: { type: Date, default: null },
    monthlySalary: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ["pending", "hr_approved", "approved", "rejected"], default: "pending", index: true },
    months: { type: Number, min: 1, max: 12, default: null },
    startMonth: { type: String, match: /^\d{4}-\d{2}$/, default: null },
    hrReviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    hrReviewedAt: { type: Date, default: null },
    hrNote: { type: String, trim: true, maxlength: 500, default: "" },
    financeReviewedAt: { type: Date, default: null },
    financeNote: { type: String, trim: true, maxlength: 500, default: "" },
    financeRef: { type: String, trim: true, maxlength: 120, default: "" },
    rejectedBy: { type: String, enum: ["hr", "finance", null], default: null },
    loan: { type: Schema.Types.ObjectId, ref: "Loan", default: null },
    /**
     * HR, when HR raised it for the employee — already approved by HR, so it
     * starts with finance. Null when the employee asked for it themselves.
     */
    raisedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** HR went above one month's salary, with a note saying why. */
    overLimit: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

// One open request per person — a second while the first is still in
// someone's hands is a duplicate, not a new ask.
salaryAdvanceSchema.index(
  { employee: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["pending", "hr_approved"] } } }
);
salaryAdvanceSchema.index({ organization: 1, status: 1, createdAt: -1 });
salaryAdvanceSchema.index({ user: 1, createdAt: -1 });

export const SalaryAdvance = mongoose.model<ISalaryAdvance>("SalaryAdvance", salaryAdvanceSchema);
