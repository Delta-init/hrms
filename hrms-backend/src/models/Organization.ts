import mongoose, { Schema } from "mongoose";
import type { IOrganization } from "../types/index.js";

const settingsSchema = new Schema(
  {
    currency: { type: String, trim: true, uppercase: true, maxlength: 6, default: "AED" },
    timeZone: { type: String, trim: true, maxlength: 60, default: "Asia/Dubai" },
    smtpHost: { type: String, trim: true, maxlength: 200 },
    smtpPort: { type: String, trim: true, maxlength: 6 },
    smtpUser: { type: String, trim: true, maxlength: 200 },
    smtpPass: { type: String, trim: true, maxlength: 200 },
    smtpSecure: { type: Boolean, default: false },
    mailFrom: { type: String, trim: true, maxlength: 200 },
  },
  { _id: false }
);

const organizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: [true, "Organization name is required"], trim: true, maxlength: 120 },
    code: { type: String, required: [true, "Code is required"], unique: true, trim: true, uppercase: true, maxlength: 20 },
    logo: { type: String, trim: true },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    settings: { type: settingsSchema, default: () => ({}) },
  },
  { timestamps: true, versionKey: false }
);

export const Organization = mongoose.model<IOrganization>("Organization", organizationSchema);
