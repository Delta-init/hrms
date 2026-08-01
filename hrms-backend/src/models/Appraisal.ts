import mongoose, { Schema } from "mongoose";
import type { IAppraisal } from "../types/index.js";

const appraisalGoalSchema = new Schema(
  {
    title: { type: String, required: [true, "Goal title is required"], trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 1000 },
    weight: { type: Number, min: 0, max: 100, default: 0 },
    selfRating: { type: Number, min: 1, max: 5, default: null },
    managerRating: { type: Number, min: 1, max: 5, default: null },
  },
  { timestamps: false }
);

/** One employee's appraisal for a cycle — goals, self-review, then a manager review. */
const appraisalSchema = new Schema<IAppraisal>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    cycle: { type: Schema.Types.ObjectId, ref: "PerformanceCycle", required: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    goals: { type: [appraisalGoalSchema], default: [] },
    selfComment: { type: String, trim: true, maxlength: 2000 },
    managerComment: { type: String, trim: true, maxlength: 2000 },
    status: { type: String, enum: ["draft", "submitted", "completed"], default: "draft", index: true },
    overallRating: { type: Number, min: 1, max: 5, default: null },
    submittedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

appraisalSchema.index({ organization: 1, cycle: 1, employee: 1 }, { unique: true });
appraisalSchema.index({ organization: 1, user: 1 });

export const Appraisal = mongoose.model<IAppraisal>("Appraisal", appraisalSchema);
