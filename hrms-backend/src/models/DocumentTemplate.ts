import mongoose, { Schema } from "mongoose";

/**
 * A master agreement PDF that new joiners sign.
 *
 * Versioned rather than overwritten. When the NDA is revised, everything
 * already signed has to keep pointing at the wording it was signed against —
 * a signature is worthless if the document underneath it can change afterwards.
 * Uploading a replacement deactivates the previous version; it is never deleted.
 *
 * `variant` is the onsite/remote split, and it is the reason this collection
 * exists rather than one file per kind: the two versions are different legal
 * documents and giving somebody the wrong one is not a cosmetic mistake.
 */
const documentTemplateSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    kind: { type: String, enum: ["nda", "tc"], required: true },
    variant: { type: String, enum: ["onsite", "remote"], required: true },
    /** Bumped on every upload for a kind+variant; signatures record which they signed. */
    version: { type: Number, required: true, min: 1 },
    fileKey: { type: String, required: true, trim: true },
    fileName: { type: String, trim: true, maxlength: 260 },
    /** SHA-256 of the stored file, so a signed copy can be traced to its source. */
    sha256: { type: String, required: true, trim: true, maxlength: 64 },
    pageCount: { type: Number, default: 0 },
    /** Only one version of each kind+variant is issued to new joiners. */
    active: { type: Boolean, default: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

documentTemplateSchema.index({ organization: 1, kind: 1, variant: 1, version: -1 });

export const DocumentTemplate = mongoose.model("DocumentTemplate", documentTemplateSchema);
