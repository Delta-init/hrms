import mongoose, { Schema } from "mongoose";
import type { IProcurementIssue } from "../types/index.js";

/**
 * Some of a procured item given out — ten toilet cleaners to housekeeping, a
 * box of markers to a trainer.
 *
 * Matched to its item by name rather than to one procurement record: the same
 * thing is bought again and again, and what HR hands out comes from the shelf,
 * not from a particular purchase. Received minus given out is what is left.
 */
const procurementIssueSchema = new Schema<IProcurementIssue>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    item: { type: String, required: true, trim: true, maxlength: 160 },
    itemKey: { type: String, required: true, trim: true, maxlength: 160 },
    quantity: { type: Number, required: true, min: 1 },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    department: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    date: { type: Date, required: true },
    note: { type: String, trim: true, maxlength: 300, default: "" },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

procurementIssueSchema.index({ organization: 1, itemKey: 1, date: 1 });

export const ProcurementIssue = mongoose.model<IProcurementIssue>("ProcurementIssue", procurementIssueSchema);
