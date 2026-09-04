import mongoose, { Schema } from "mongoose";
import { publicUrl } from "../config/r2.js";
import type { IEmployee } from "../types/index.js";

const educationSchema = new Schema(
  {
    qualification: { type: String, trim: true, maxlength: 120 },
    from: { type: String, trim: true, maxlength: 20 },
    to: { type: String, trim: true, maxlength: 20 },
    institute: { type: String, trim: true, maxlength: 160 },
  },
  { _id: false }
);

const addressSchema = new Schema(
  {
    address: { type: String, trim: true, maxlength: 300 },
    city: { type: String, trim: true, maxlength: 80 },
    state: { type: String, trim: true, maxlength: 80 },
    country: { type: String, trim: true, maxlength: 80 },
  },
  { _id: false }
);

const emergencyContactSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 100 },
    relation: { type: String, trim: true, maxlength: 60 },
    address: { type: String, trim: true, maxlength: 300 },
    city: { type: String, trim: true, maxlength: 80 },
    state: { type: String, trim: true, maxlength: 80 },
    country: { type: String, trim: true, maxlength: 80 },
    phoneNumber: { type: String, trim: true, maxlength: 30 },
    email: { type: String, trim: true, lowercase: true, maxlength: 120 },
  },
  { _id: false }
);

const bankSchema = new Schema(
  {
    bankAccountNumber: { type: String, trim: true, maxlength: 40 },
    ibanIfsc: { type: String, trim: true, maxlength: 40 },
    bankName: { type: String, trim: true, maxlength: 120 },
    nameInBank: { type: String, trim: true, maxlength: 120 },
  },
  { _id: false }
);

const familyMemberSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 100 },
    relation: { type: String, trim: true, maxlength: 60 },
    dob: { type: Date, default: null },
    phone: { type: String, trim: true, maxlength: 30 },
  },
  { _id: false }
);

const passportSchema = new Schema(
  {
    passportNumber: { type: String, trim: true, maxlength: 40 },
    country: { type: String, trim: true, maxlength: 80 },
    issueDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
  },
  { _id: false }
);

const visaSchema = new Schema(
  {
    country: { type: String, trim: true, maxlength: 80 },
    type: { type: String, trim: true, maxlength: 60 },
    issueDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
  },
  { _id: false }
);

/** UAE work permit. Lapsing one is a compliance problem, so it is alerted on like passport/visa. */
const labourCardSchema = new Schema(
  {
    cardNumber: { type: String, trim: true, maxlength: 40 },
    issueDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
  },
  { _id: false }
);

const emiratesIdSchema = new Schema(
  {
    idNumber: { type: String, trim: true, maxlength: 40 },
    issueDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
  },
  { _id: false }
);

/**
 * Anything the fixed fields don't cover: a second passport, a driving licence,
 * a contract, a training certificate.
 *
 * One shape for both asks — a credential with an expiry, and a document with a
 * file — because in practice they're the same thing seen from two sides, and
 * splitting them would mean filing a residence permit twice to get both the
 * reminder and the scan. Every field past the label is optional, so a bare
 * "NDA · signed" entry is as valid as a fully dated permit.
 *
 * Unlike `documents`, these keep their `_id`: they are a list a person adds to,
 * not a fixed set of slots, so entries need to be addressable individually.
 */
const otherDocumentSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 120 },
    number: { type: String, trim: true, maxlength: 60 },
    issueDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 500 },
    fileName: { type: String, trim: true, maxlength: 260 },
    fileKey: { type: String, trim: true },
    mimeType: { type: String, trim: true, maxlength: 100 },
    size: { type: Number, min: 0 },
    uploadedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const documentSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: [
        "passport",
        "visa_copy",
        "emirates_id",
        "labour_card",
        "aadhaar",
        "photo",
        "education_certificate",
        "experience_certificate",
      ],
    },
    fileName: { type: String, trim: true, maxlength: 260 },
    fileKey: { type: String, required: true, trim: true },
    mimeType: { type: String, trim: true, maxlength: 100 },
    size: { type: Number, min: 0 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const employeeSchema = new Schema<IEmployee>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employeeCode: {
      type: String,
      required: [true, "Employee code is required"],
      trim: true,
      uppercase: true,
      maxlength: [20, "Employee code cannot exceed 20 characters"],
    },
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email"],
    },
    phone: { type: String, trim: true, maxlength: [30, "Phone cannot exceed 30 characters"] },
    department: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    designation: { type: String, trim: true, maxlength: [100, "Designation cannot exceed 100 characters"] },
    workSchedule: { type: Schema.Types.ObjectId, ref: "WorkSchedule", default: null },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    employmentType: {
      type: String,
      enum: ["full_time", "part_time", "contract", "intern"],
      default: "full_time",
    },
    joiningDate: { type: Date, default: null },
    status: {
      type: String,
      enum: ["active", "probation", "on_leave", "notice_period", "terminated"],
      default: "active",
    },
    location: { type: String, enum: ["india", "dubai"], default: undefined },
    /**
     * Where somebody works. Office staff are expected on site and punch at a
     * kiosk; work-from-home staff punch from the web app, which is the only
     * place their attendance can be recorded from.
     *
     * Defaults to office, because that is what everybody created or imported
     * before this field existed was — including the whole GreytHR intake. A
     * default of "wfh" would silently reclassify a hundred people.
     */
    workMode: { type: String, enum: ["office", "wfh"], default: "office" },

    /**
     * The one browser a remote employee may punch from.
     *
     * `keyHash` is a SHA-256 of a secret the browser minted for itself and
     * keeps; the secret never lands in the database, so a dump of this
     * collection does not let anybody punch as somebody else.
     *
     * `fingerprint` is not part of the check. Browsers change their user agent
     * on every update and a person would be locked out by Tuesday's patch —
     * it is recorded so that the same key surfacing on a visibly different
     * machine can be flagged for a human to look at.
     *
     * Bound on first use rather than pre-registered by HR: the alternative is
     * every new joiner waiting on an admin before they can start their day.
     * When and from where it was bound is kept, which is the part that makes
     * a first use auditable after the fact.
     */
    trustedDevice: {
      type: new Schema(
        {
          keyHash: { type: String, required: true },
          label: { type: String, trim: true, maxlength: 80, default: "" },
          fingerprint: { type: String, trim: true, maxlength: 64, default: "" },
          boundAt: { type: Date, default: Date.now },
          boundIp: { type: String, trim: true, maxlength: 64, default: "" },
          lastSeenAt: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: null,
    },
    salary: { type: Number, default: 0, min: 0 },
    currency: { type: String, trim: true, uppercase: true, default: "AED", maxlength: 6 },
    // Profile/portal photo (R2 key) + onboarding documents.
    photo: { type: String, trim: true, default: "" },
    documents: { type: [documentSchema], default: [] },

    // ── Personal ──
    title: { type: String, enum: ["mr", "mrs", "ms", "dr"], default: undefined },
    gender: { type: String, enum: ["male", "female", "other"], default: undefined },
    personalEmail: { type: String, trim: true, lowercase: true, maxlength: 120 },
    mobileNumber: { type: String, trim: true, maxlength: 30 },
    dob: { type: Date, default: null },
    bloodGroup: { type: String, trim: true, maxlength: 8 },
    nationality: { type: String, trim: true, maxlength: 80 },
    maritalStatus: { type: String, enum: ["married", "unmarried"], default: undefined },

    // ── Employment ──
    oldCompanyExperience: { type: String, trim: true, maxlength: 1000 },
    confirmationDate: { type: Date, default: null },
    probationPeriodDays: { type: Number, min: 0, default: 0 },
    noticePeriodDays: { type: Number, min: 0, default: 60 },
    // Manager can be either an Employee record or a login User (dynamic ref).
    reportingTo: { type: Schema.Types.ObjectId, refPath: "reportingToKind", default: null },
    reportingToKind: { type: String, enum: ["Employee", "User"], default: "Employee" },

    // ── Bank / education / addresses / emergency ──
    bank: { type: bankSchema, default: undefined },
    education: { type: [educationSchema], default: [] },
    currentAddress: { type: addressSchema, default: undefined },
    permanentAddress: { type: addressSchema, default: undefined },
    emergencyContacts: { type: [emergencyContactSchema], default: [] },
    familyMembers: { type: [familyMemberSchema], default: [] },
    passport: { type: passportSchema, default: undefined },
    visa: { type: visaSchema, default: undefined },
    labourCard: { type: labourCardSchema, default: undefined },
    emiratesId: { type: emiratesIdSchema, default: undefined },
    otherDocuments: { type: [otherDocumentSchema], default: [] },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/**
 * Serve the stored photo as a URL.
 *
 * `photo` holds an object key, which is useless to a browser. Doing this on the
 * schema means every response that returns an employee carries it, rather than
 * each endpoint remembering to convert — and it is the single place to change
 * when object access moves behind signed URLs.
 */
employeeSchema.set("toJSON", {
  transform(_doc, ret) {
    const out = ret as unknown as Record<string, unknown>;
    out.photoUrl = out.photo ? publicUrl(String(out.photo)) : "";
    if (Array.isArray(out.otherDocuments)) {
      out.otherDocuments = (out.otherDocuments as Array<Record<string, unknown>>).map((d) => ({
        ...d,
        fileUrl: d.fileKey ? publicUrl(String(d.fileKey)) : "",
      }));
    }
    return out;
  },
});

employeeSchema.index({ department: 1 });
employeeSchema.index({ "otherDocuments.expiryDate": 1 });
employeeSchema.index({ status: 1 });

employeeSchema.index({ organization: 1, employeeCode: 1 }, { unique: true });

export const Employee = mongoose.model<IEmployee>("Employee", employeeSchema);
