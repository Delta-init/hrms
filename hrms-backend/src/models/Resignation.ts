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
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, versionKey: false }
);

resignationSchema.index({ employee: 1, status: 1 });
resignationSchema.index({ status: 1, lastWorkingDay: 1 });

export const Resignation = mongoose.model<IResignation>("Resignation", resignationSchema);
