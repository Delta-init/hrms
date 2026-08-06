import mongoose, { Schema } from "mongoose";
import type { IResignation } from "../types/index.js";

const settlementLineSchema = new Schema(
  { label: { type: String, required: true, trim: true, maxlength: 120 }, amount: { type: Number, required: true } },
  { _id: false }
);

/** Computed full-&-final settlement snapshot for an exit. */
const settlementSchema = new Schema(
  {
    computedAt: { type: Date, default: null },
    basic: { type: Number, default: 0 },
    dayRate: { type: Number, default: 0 },
    tenureYears: { type: Number, default: 0 },
    gratuity: { type: Number, default: 0 },
    leaveEncashmentDays: { type: Number, default: 0, min: 0 },
    noticeShortfallDays: { type: Number, default: 0, min: 0 },
    earnings: { type: [settlementLineSchema], default: [] },
    deductions: { type: [settlementLineSchema], default: [] },
    totalEarnings: { type: Number, default: 0 },
    totalDeductions: { type: Number, default: 0 },
    netPayable: { type: Number, default: 0 },
    currency: { type: String, default: "AED" },
    settled: { type: Boolean, default: false },
    settledAt: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 1000 },
  },
  { _id: false }
);

/**
 * One department's sign-off on an exit. Kept as an array of items rather than
 * flags so an organisation can add its own without a schema change, and so each
 * line carries who cleared it and when.
 */
const clearanceItemSchema = new Schema(
  {
    department: {
      type: String,
      enum: ["it", "finance", "hr", "admin", "manager"],
      required: true,
    },
    item: { type: String, required: true, trim: true, maxlength: 150 },
    status: { type: String, enum: ["pending", "cleared", "not_applicable"], default: "pending" },
    notes: { type: String, trim: true, maxlength: 500 },
    clearedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    clearedAt: { type: Date, default: null },
  },
  { timestamps: false }
);

const ratingField = { type: Number, min: 1, max: 5, default: null };

/** Structured exit interview, recorded once by HR. */
const exitInterviewSchema = new Schema(
  {
    conductedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    conductedAt: { type: Date, default: null },
    primaryReason: {
      type: String,
      enum: [
        "compensation", "career_growth", "work_life_balance", "management",
        "relocation", "higher_studies", "health", "role_mismatch", "other",
      ],
      default: undefined,
    },
    ratings: {
      workEnvironment: ratingField,
      management: ratingField,
      growth: ratingField,
      compensation: ratingField,
      workLifeBalance: ratingField,
    },
    whatWentWell: { type: String, trim: true, maxlength: 2000 },
    whatCouldImprove: { type: String, trim: true, maxlength: 2000 },
    wouldRecommend: { type: Boolean, default: null },
    // HR's own judgement, deliberately separate from the employee's answers.
    eligibleForRehire: { type: Boolean, default: null },
    notes: { type: String, trim: true, maxlength: 2000 },
  },
  { _id: false }
);

const resignationSchema = new Schema<IResignation>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: [true, "Employee is required"] },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    resignationType: {
      type: String,
      enum: ["resignation", "termination", "retirement", "end_of_contract", "absconding"],
      default: "resignation",
    },
    resignationDate: { type: Date, required: [true, "Resignation date is required"] },
    noticeRequired: { type: Boolean, default: true },
    noticePeriodDays: { type: Number, min: 0, default: 60 },
    lastWorkingDay: { type: Date, required: [true, "Last working day is required"] },
    reason: { type: String, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "withdrawn", "relieved"],
      default: "pending",
    },
    // ── Exit details ──
    leavingDate: { type: Date, default: null },
    finalSettlement: { type: Number, min: 0, default: null },
    left: { type: Boolean, default: false },
    noticePeriodServed: { type: Boolean, default: false },
    // ── Leave settlement ──
    leaveSalaryPaid: { type: Boolean, default: false },
    ticketAllowancePaid: { type: Boolean, default: false },
    paymentType: { type: String, enum: ["cash", "bank_transfer", "cheque"], default: undefined },
    remarks: { type: String, trim: true, maxlength: 1000 },
    settlement: { type: settlementSchema, default: null },
    // ── Exit clearance & interview ──
    clearance: { type: [clearanceItemSchema], default: [] },
    exitInterview: { type: exitInterviewSchema, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, versionKey: false }
);

resignationSchema.index({ employee: 1, status: 1 });
resignationSchema.index({ status: 1, lastWorkingDay: 1 });

export const Resignation = mongoose.model<IResignation>("Resignation", resignationSchema);
