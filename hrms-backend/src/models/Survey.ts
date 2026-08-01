import mongoose, { Schema } from "mongoose";
import type { ISurvey } from "../types/index.js";

const surveyQuestionSchema = new Schema(
  {
    text: { type: String, required: [true, "Question text is required"], trim: true, maxlength: 300 },
    type: { type: String, enum: ["text", "single_choice", "rating"], default: "text" },
    options: { type: [String], default: [] },
    required: { type: Boolean, default: true },
  },
  { timestamps: false }
);

/** An admin-authored question set employees can respond to once. */
const surveySchema = new Schema<ISurvey>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    title: { type: String, required: [true, "Title is required"], trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 1000 },
    questions: { type: [surveyQuestionSchema], default: [] },
    status: { type: String, enum: ["draft", "active", "closed"], default: "draft" },
    closesAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

surveySchema.index({ organization: 1, status: 1, createdAt: -1 });

export const Survey = mongoose.model<ISurvey>("Survey", surveySchema);
