import mongoose, { Schema } from "mongoose";
import type { ISurveyResponse } from "../types/index.js";

const surveyAnswerSchema = new Schema(
  {
    question: { type: Schema.Types.ObjectId, required: true },
    value: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: false, _id: false }
);

/** One employee's submitted answers to a survey — one per {survey, user}. */
const surveyResponseSchema = new Schema<ISurveyResponse>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    survey: { type: Schema.Types.ObjectId, ref: "Survey", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    answers: { type: [surveyAnswerSchema], default: [] },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false }
);

surveyResponseSchema.index({ organization: 1, survey: 1, user: 1 }, { unique: true });

export const SurveyResponse = mongoose.model<ISurveyResponse>("SurveyResponse", surveyResponseSchema);
