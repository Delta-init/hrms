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

const documentSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: [
        "passport",
        "visa_copy",
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
    return out;
  },
});

employeeSchema.index({ department: 1 });
employeeSchema.index({ status: 1 });

employeeSchema.index({ organization: 1, employeeCode: 1 }, { unique: true });

export const Employee = mongoose.model<IEmployee>("Employee", employeeSchema);
