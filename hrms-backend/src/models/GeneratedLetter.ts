import mongoose, { Schema } from "mongoose";
import type { IGeneratedLetter } from "../types/index.js";

/** One letter issued to an employee — the merge-resolved body is stored as a
 *  snapshot, so editing or deleting the source template never changes a
 *  letter that was already issued. */
const generatedLetterSchema = new Schema<IGeneratedLetter>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: [true, "Employee is required"] },
    template: { type: Schema.Types.ObjectId, ref: "LetterTemplate", default: null },
    templateName: { type: String, trim: true, maxlength: 120 },
    category: {
      type: String,
      enum: ["offer", "appointment", "confirmation", "experience", "relieving", "warning", "other"],
      default: "other",
    },
    subject: { type: String, trim: true, maxlength: 200 },
    content: { type: String, required: true, maxlength: 20000 },
    issuedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    issuedAt: { type: Date, default: Date.now },
    notes: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true, versionKey: false }
);

generatedLetterSchema.index({ organization: 1, employee: 1, issuedAt: -1 });

export const GeneratedLetter = mongoose.model<IGeneratedLetter>("GeneratedLetter", generatedLetterSchema);
