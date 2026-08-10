import mongoose, { Schema } from "mongoose";
import type { ICandidate } from "../types/index.js";

/**
 * A person, once.
 *
 * Kept apart from the application deliberately: somebody who was turned down in
 * March and applies again in September is the same person, and the second
 * conversation is better for knowing about the first. Storing them per-vacancy
 * would throw that away every time.
 */
const candidateSchema = new Schema<ICandidate>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 160 },
    phone: { type: String, trim: true, maxlength: 40 },
    source: { type: String, trim: true, maxlength: 60 },
    currentCompany: { type: String, trim: true, maxlength: 120 },
    currentDesignation: { type: String, trim: true, maxlength: 120 },
    totalExperienceYears: { type: Number, min: 0, max: 60 },
    noticePeriodDays: { type: Number, min: 0, max: 365 },
    expectedSalary: { type: Number, min: 0 },
    currency: { type: String, trim: true, uppercase: true, maxlength: 3, default: "AED" },
    location: { type: String, trim: true, maxlength: 80 },
    resumeKey: { type: String, trim: true },
    resumeFileName: { type: String, trim: true, maxlength: 200 },
    links: { type: [String], default: [] },
    notes: { type: String, trim: true, maxlength: 2000 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

// One record per person per tenant — the email is what makes a re-application
// recognisable as the same person rather than a duplicate.
candidateSchema.index({ organization: 1, email: 1 }, { unique: true });

export const Candidate = mongoose.model<ICandidate>("Candidate", candidateSchema);
