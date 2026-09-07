import mongoose, { Schema } from "mongoose";

/**
 * The joining/onboarding PDF a new hire's own details are stamped onto.
 *
 * A separate, deliberately simpler collection from `DocumentTemplate` rather
 * than a third `kind` there: that one is built around the signing pipeline —
 * variants, a review queue, a hard-coded pair of kinds threaded through half
 * a dozen files — none of which this needs. This is one flat PDF per
 * organisation, filled from data already on the employee record rather than
 * read and re-typed, with nothing to review before it exists.
 *
 * Versioned the same way regardless: uploading a replacement deactivates the
 * one before it rather than overwriting it, so a form generated last month
 * still traces back to the layout it was actually stamped onto.
 */
const onboardingFormTemplateSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    version: { type: Number, required: true, min: 1 },
    fileKey: { type: String, required: true, trim: true },
    fileName: { type: String, trim: true, maxlength: 260 },
    active: { type: Boolean, default: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

onboardingFormTemplateSchema.index({ organization: 1, version: -1 });

export const OnboardingFormTemplate = mongoose.model("OnboardingFormTemplate", onboardingFormTemplateSchema);
