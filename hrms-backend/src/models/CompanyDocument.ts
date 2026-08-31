import mongoose, { Schema } from "mongoose";
import { publicUrl } from "../config/r2.js";

/**
 * A document belonging to the business rather than to a person.
 *
 * Trade licences, tenancy contracts, establishment cards, insurance policies —
 * things that expire, that somebody has to renew, and that until now lived in a
 * drawer or somebody's inbox. Employee documents already had a home; these had
 * none, so the register of what the company itself must keep current existed
 * nowhere.
 *
 * The company is a plain name, not a reference. A group runs several licensed
 * entities that are not tenants of this system and never will be — modelling
 * them as organizations would mean creating logins and employees for companies
 * that only ever appear on a licence.
 */
const companyDocumentSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    /** Which entity the document belongs to, as it reads on the paper. */
    companyName: { type: String, required: true, trim: true, maxlength: 120, index: true },
    /**
     * Open text, normalised to a slug.
     *
     * A closed list would be wrong within the month: every free zone and
     * authority issues its own paperwork, and the one kind nobody thought of is
     * always the one that matters. The UI suggests the common ones and accepts
     * anything else.
     */
    documentType: { type: String, required: true, trim: true, maxlength: 60, index: true },
    number: { type: String, trim: true, maxlength: 60, default: "" },
    issueDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 500, default: "" },
    fileName: { type: String, trim: true, maxlength: 260, default: "" },
    fileKey: { type: String, trim: true, default: "" },
    mimeType: { type: String, trim: true, maxlength: 100, default: "" },
    size: { type: Number, min: 0, default: 0 },
    uploadedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

// The renewal list is "what expires soonest in this org", which is this index.
companyDocumentSchema.index({ organization: 1, expiryDate: 1 });

/** The stored key is useless to a browser; every response carries the URL. */
companyDocumentSchema.set("toJSON", {
  transform(_doc, ret) {
    const out = ret as unknown as Record<string, unknown>;
    out.fileUrl = out.fileKey ? publicUrl(String(out.fileKey)) : "";
    return out;
  },
});

export const CompanyDocument = mongoose.model("CompanyDocument", companyDocumentSchema);
