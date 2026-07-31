import mongoose, { Schema } from "mongoose";
import type { IOnboardingTemplate } from "../types/index.js";

const templateTaskSchema = new Schema(
  {
    title: { type: String, required: [true, "Title is required"], trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 500 },
    category: {
      type: String,
      enum: ["documentation", "it_setup", "hr", "facilities", "training"],
      default: "documentation",
    },
    assigneeRole: { type: String, enum: ["hr", "it", "manager", "employee"], default: "hr" },
    dueDayOffset: { type: Number, default: 0 },
  },
  { timestamps: false }
);

/** Reusable set of onboarding tasks — applied to a new hire to create their checklist. */
const onboardingTemplateSchema = new Schema<IOnboardingTemplate>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    name: { type: String, required: [true, "Name is required"], trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500 },
    tasks: { type: [templateTaskSchema], default: [] },
  },
  { timestamps: true, versionKey: false }
);

onboardingTemplateSchema.index({ organization: 1, name: 1 }, { unique: true });

export const OnboardingTemplate = mongoose.model<IOnboardingTemplate>("OnboardingTemplate", onboardingTemplateSchema);
