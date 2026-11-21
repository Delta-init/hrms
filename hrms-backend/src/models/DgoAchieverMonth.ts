import mongoose, { Schema } from "mongoose";

/**
 * One month's monthly achievers (elite awards).
 *
 * provisional (figures fetched from Root, ranked) → verified (finance checked
 * the amounts) → published (a second person approved: every prize posted to the
 * winner's wallet from the elite pool). locked when the month's confirmed
 * collections are under the elite threshold, so nothing can be awarded. The
 * categories are copied in when figures are fetched, so a later change to them
 * leaves this month as it was decided.
 */
const candidateSchema = new Schema(
  {
    email: String,
    name: String,
    employee: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    employeeName: { type: String, default: null },
    value: Number,
    detail: { type: String, default: null },
    eligible: Boolean,
    why: { type: String, default: null },
    tied: { type: Boolean, default: false },
  },
  { _id: false }
);

const categorySchema = new Schema(
  {
    code: { type: String, required: true },
    name: { type: String, required: true },
    metric: { type: String, required: true },
    place: { type: Number, required: true },
    threshold: { type: Number, required: true },
    prizeAed: { type: Number, required: true },
    prizePoints: { type: Number, required: true },
    winner: { type: candidateSchema, default: null },
    tie: { type: Boolean, default: false },
    pickedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    pickedByName: { type: String, default: null },
    candidates: { type: [candidateSchema], default: [] },
    awardEvent: { type: Schema.Types.ObjectId, ref: "DgoEarningEvent", default: null },
  },
  { _id: false }
);

const trailSchema = new Schema(
  {
    action: { type: String, required: true },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    byName: { type: String, default: null },
    note: { type: String, default: null },
    at: { type: Date, required: true },
  },
  { _id: false }
);

const dgoAchieverMonthSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    month: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    status: { type: String, enum: ["provisional", "locked", "verified", "approved", "published"], required: true },
    lockedReason: { type: String, default: null },
    problems: { type: [String], default: [] },
    pointValueAed: { type: Number, required: true },
    categories: { type: [categorySchema], default: [] },
    fetchedAt: { type: Date, default: null },
    fetchedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    fetchedByName: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    verifiedByName: { type: String, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedByName: { type: String, default: null },
    publishedAt: { type: Date, default: null },
    publishedByName: { type: String, default: null },
    trail: { type: [trailSchema], default: [] },
  },
  { timestamps: true, versionKey: false }
);

dgoAchieverMonthSchema.index({ organization: 1, month: 1 }, { unique: true });

export const DgoAchieverMonth = mongoose.model("DgoAchieverMonth", dgoAchieverMonthSchema);
