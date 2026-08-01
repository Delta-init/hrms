import mongoose, { Schema } from "mongoose";
import type { IPerformanceCycle } from "../types/index.js";

/** An appraisal period (e.g. "H1 2026 Review"). Activating one generates an Appraisal per employee. */
const performanceCycleSchema = new Schema<IPerformanceCycle>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    title: { type: String, required: [true, "Title is required"], trim: true, maxlength: 150 },
    startDate: { type: Date, required: [true, "Start date is required"] },
    endDate: { type: Date, required: [true, "End date is required"] },
    status: { type: String, enum: ["draft", "active", "closed"], default: "draft" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

performanceCycleSchema.index({ organization: 1, status: 1, createdAt: -1 });

export const PerformanceCycle = mongoose.model<IPerformanceCycle>("PerformanceCycle", performanceCycleSchema);
