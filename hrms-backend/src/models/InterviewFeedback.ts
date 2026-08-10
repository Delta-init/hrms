import mongoose, { Schema } from "mongoose";
import type { IInterviewFeedback } from "../types/index.js";

/**
 * One panellist's verdict, one row each.
 *
 * Not a single blob on the interview: with one shared field the last person to
 * type wins, and the disagreement between two interviewers is usually the most
 * useful thing in the room. Kept separate, a split panel stays visible.
 */
const interviewFeedbackSchema = new Schema<IInterviewFeedback>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
    interview: { type: Schema.Types.ObjectId, ref: "Interview", required: true, index: true },
    panellist: { type: Schema.Types.ObjectId, ref: "User", required: true },

    recommendation: { type: String, enum: ["strong_yes", "yes", "no", "strong_no"], required: true },
    scores: {
      type: [{ skill: { type: String, trim: true, maxlength: 60 }, rating: { type: Number, min: 1, max: 5 } }],
      default: [],
      _id: false,
    },
    notes: { type: String, trim: true, maxlength: 4000 },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false }
);

// One verdict per person per interview — re-submitting revises it.
interviewFeedbackSchema.index({ organization: 1, interview: 1, panellist: 1 }, { unique: true });

export const InterviewFeedback = mongoose.model<IInterviewFeedback>("InterviewFeedback", interviewFeedbackSchema);
