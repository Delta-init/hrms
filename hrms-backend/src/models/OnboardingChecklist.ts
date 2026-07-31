import mongoose, { Schema } from "mongoose";
import type { IOnboardingChecklist } from "../types/index.js";

const checklistTaskSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 500 },
    category: {
      type: String,
      enum: ["documentation", "it_setup", "hr", "facilities", "training"],
      default: "documentation",
    },
    assigneeRole: { type: String, enum: ["hr", "it", "manager", "employee"], default: "hr" },
    dueDate: { type: Date, default: null },
    status: { type: String, enum: ["pending", "completed"], default: "pending" },
    completedAt: { type: Date, default: null },
    completedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: false }
);

/** One new hire's onboarding checklist — a snapshot of tasks copied from a
 *  template at creation time, tracked independently as each one completes. */
const onboardingChecklistSchema = new Schema<IOnboardingChecklist>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    templateName: { type: String, trim: true, maxlength: 120 },
    tasks: { type: [checklistTaskSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

onboardingChecklistSchema.index({ organization: 1, employee: 1 }, { unique: true });

export const OnboardingChecklist = mongoose.model<IOnboardingChecklist>("OnboardingChecklist", onboardingChecklistSchema);
