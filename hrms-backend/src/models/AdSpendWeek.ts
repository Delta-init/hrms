import mongoose, { Schema } from "mongoose";
import type { IAdSpendWeek } from "../types/index.js";

/**
 * One week of recruitment advertising, Monday to Sunday: for each role, what
 * went on each platform.
 *
 * A week is one document so it is saved, reminded about and reported missing
 * as one thing — the recruiter fills a week in, not a row at a time. Amounts
 * are numbers rounded to the fils on the way in and the total is computed by
 * the service, never typed, which is the whole difference from the sheet this
 * replaced: there, text amounts and a formula that skipped a column lost
 * 864 AED of 9,163 without anybody noticing.
 */
const lineSchema = new Schema(
  {
    requisition: { type: Schema.Types.ObjectId, ref: "JobRequisition", default: null },
    role: { type: String, required: true, trim: true, maxlength: 150 },
    amounts: {
      type: [
        new Schema(
          {
            platform: { type: String, required: true, trim: true, maxlength: 40 },
            amount: { type: Number, required: true, min: 0, max: 10_000_000 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    note: { type: String, trim: true, maxlength: 300, default: "" },
  },
  { _id: true }
);

const attachmentSchema = new Schema(
  {
    key: { type: String, required: true },
    fileName: { type: String, required: true, trim: true, maxlength: 200 },
    contentType: { type: String, default: "application/octet-stream" },
    size: { type: Number, default: 0 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const adSpendWeekSchema = new Schema<IAdSpendWeek>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    weekStart: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    lines: { type: [lineSchema], default: [] },
    total: { type: Number, required: true, min: 0, default: 0 },
    currency: { type: String, trim: true, uppercase: true, maxlength: 3, default: "AED" },
    nothingSpent: { type: Boolean, default: false },
    note: { type: String, trim: true, maxlength: 1000, default: "" },
    attachments: { type: [attachmentSchema], default: [] },
    source: { type: String, enum: ["entry", "import"], default: "entry" },
    loggedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    loggedAt: { type: Date, default: Date.now },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** Every save, so a changed figure can always be traced to who changed it and from what. */
    history: {
      type: [
        new Schema(
          {
            at: { type: Date, required: true },
            by: { type: Schema.Types.ObjectId, ref: "User", default: null },
            action: { type: String, enum: ["logged", "changed", "imported"], required: true },
            total: { type: Number, required: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { timestamps: true, versionKey: false }
);

// One log per week per organisation — saving a week again corrects it.
adSpendWeekSchema.index({ organization: 1, weekStart: 1 }, { unique: true });

export const AdSpendWeek = mongoose.model<IAdSpendWeek>("AdSpendWeek", adSpendWeekSchema);
