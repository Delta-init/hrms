import mongoose, { Schema } from "mongoose";
import { workflowStateFields } from "./approvalWorkflowFields.js";

/** One document within a signing: which template, and the stamped result. */
const signedDocumentSchema = new Schema(
  {
    template: { type: Schema.Types.ObjectId, ref: "DocumentTemplate", required: true },
    kind: { type: String, enum: ["nda", "tc"], required: true },
    version: { type: Number, required: true },
    /**
     * SHA-256 of the file the employee was actually shown, copied from the
     * template at signing time. This is what makes the signature provable
     * later: it pins the wording, independently of anything edited since.
     */
    sourceSha256: { type: String, required: true, trim: true, maxlength: 64 },
    /** The stamped copy — original plus their signature and an audit page. */
    signedKey: { type: String, required: true, trim: true },
  },
  { _id: false }
);

/**
 * A new joiner's signed agreements, awaiting HR verification.
 *
 * One record per signing, holding both documents, because they are executed in
 * a single act by one person on one day — splitting them would invite a state
 * where somebody has signed the NDA but not the terms.
 *
 * Rejection is not deletion. The record stays with its trail and the employee
 * is asked to sign again, so "signed, rejected, re-signed" remains readable
 * afterwards rather than looking like they simply took two attempts.
 */
const signedAgreementSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    /** Which set they were served. Frozen here: their work mode may change later. */
    variant: { type: String, enum: ["onsite", "remote"], required: true },
    documents: { type: [signedDocumentSchema], default: [] },

    /** The drawn signature, stored once and stamped into every document. */
    signatureKey: { type: String, required: true, trim: true },
    typedName: { type: String, required: true, trim: true, maxlength: 120 },
    signedAt: { type: Date, default: Date.now },
    // Where it was signed from — the same evidence a remote punch carries.
    ip: { type: String, trim: true, maxlength: 64, default: null },
    userAgent: { type: String, trim: true, maxlength: 400, default: null },
    /** Proof the induction was watched before this was allowed to happen. */
    videoView: { type: Schema.Types.ObjectId, ref: "VideoView", default: null },

    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, trim: true, maxlength: 500 },
    ...workflowStateFields,
  },
  { timestamps: true, versionKey: false }
);

signedAgreementSchema.index({ organization: 1, status: 1, createdAt: -1 });

export const SignedAgreement = mongoose.model("SignedAgreement", signedAgreementSchema);
