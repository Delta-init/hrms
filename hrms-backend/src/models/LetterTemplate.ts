import mongoose, { Schema } from "mongoose";
import type { ILetterTemplate } from "../types/index.js";

/** A reusable letter body ({{employee.name}}-style merge tokens) — issued to
 *  an employee to create a GeneratedLetter (a resolved, immutable snapshot). */
const letterTemplateSchema = new Schema<ILetterTemplate>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    name: { type: String, required: [true, "Name is required"], trim: true, maxlength: 120 },
    category: {
      type: String,
      enum: ["offer", "appointment", "confirmation", "experience", "relieving", "warning", "other"],
      default: "other",
    },
    subject: { type: String, trim: true, maxlength: 200 },
    body: { type: String, required: [true, "Body is required"], maxlength: 20000 },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

letterTemplateSchema.index({ organization: 1, name: 1 }, { unique: true });

export const LetterTemplate = mongoose.model<ILetterTemplate>("LetterTemplate", letterTemplateSchema);
