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
    /**
     * Hold office staff to punching at a kiosk.
     *
     * Off by default, and deliberately a switch rather than implied by the
     * work mode itself. Every employee is office until somebody says otherwise,
     * so enforcing it the moment the field shipped would have taken the
     * clock-in button away from everybody at once, before HR had classified a
     * single person. Turn it on once the list is right.
     */
    enforceWorkMode: { type: Boolean, default: false },
    /**
     * Tie each remote employee's punches to one browser.
     *
     * Opt-in for the same reason as the setting above, and for one more: the
     * first punch after it is switched on registers whatever device somebody
     * happens to be holding. Turning it on mid-afternoon binds half the team
     * to their phones.
     */
    bindRemoteDevice: { type: Boolean, default: false },
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
