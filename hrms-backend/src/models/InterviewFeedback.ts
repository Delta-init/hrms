import mongoose, { Schema } from "mongoose";
import type { IInterviewFeedback } from "../types/index.js";

/**
 * One panellist's verdict, one row each.
 *
 * Not a single blob on the interview: with one shared field the last person to
 * type wins, and the disagreement between two interviewers is usually the most
 * useful thing in the room. Kept separate, a split panel stays visible.
 *
 * It is also the panellist's marking sheet for the role's questions: what the
 * candidate said to each, and the marks given out of that question's maximum.
 * A draft is saved as they go and seen by nobody else; only a submitted sheet
 * counts, and only once every question is marked.
 */
const interviewFeedbackSchema = new Schema<IInterviewFeedback>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
    interview: { type: Schema.Types.ObjectId, ref: "Interview", required: true, index: true },
    panellist: { type: Schema.Types.ObjectId, ref: "User", required: true },

    /** Submitted, or still being filled in. Rows from before drafts existed were all submitted. */
    status: { type: String, enum: ["draft", "submitted"], default: "submitted" },
    // Required to submit, not to save a draft — see InterviewService.saveSheet().
    recommendation: { type: String, enum: ["strong_yes", "yes", "no", "strong_no", null], default: null },
    scores: {
      type: [{ skill: { type: String, trim: true, maxlength: 60 }, rating: { type: Number, min: 1, max: 5 } }],
      default: [],
      _id: false,
    },
    notes: { type: String, trim: true, maxlength: 4000 },
    // Each question copied as it was asked, beside what was said and the marks —
    // the requester may rewrite the questions later, and a mark stays a mark
    // against the question that was actually put.
    answers: {
      type: [{
        questionId: { type: Schema.Types.ObjectId, required: true },
        question: { type: String, trim: true, maxlength: 1000 },
        expectedAnswer: { type: String, trim: true, maxlength: 4000 },
        maxMarks: { type: Number, min: 1, max: 100 },
        response: { type: String, trim: true, maxlength: 4000, default: "" },
        marks: { type: Number, min: 0, max: 100, default: null },
      }],
      default: [],
      _id: false,
    },
    /** Out of `maxTotal`, the sum of the questions' maximums. Null with no questions. */
    totalMarks: { type: Number, default: null },
    maxTotal: { type: Number, default: null },
    /** Null while it is a draft. */
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false }
);

// One verdict per person per interview — re-submitting revises it.
interviewFeedbackSchema.index({ organization: 1, interview: 1, panellist: 1 }, { unique: true });

export const InterviewFeedback = mongoose.model<IInterviewFeedback>("InterviewFeedback", interviewFeedbackSchema);
