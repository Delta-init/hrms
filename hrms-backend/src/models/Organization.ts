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
     * How closely a remote employee is held to one browser.
     *
     *  off     — nothing about the device is recorded or registered.
     *  flag    — the first browser is registered and punches from any other are
     *            still accepted, marked as an anomaly for someone to review.
     *  enforce — punches from any other browser are refused outright.
     *
     * Three settings rather than a switch because the middle one is where most
     * organizations should start: it answers "is this actually happening, and
     * to whom?" before anybody is locked out over it, and the answer is usually
     * a handful of people with an ordinary explanation.
     *
     * Off by default, and worth switching on at the start of a day — whatever
     * device somebody is holding when they next punch is the one they get.
     */
    remoteDevice: { type: String, enum: ["off", "flag", "enforce"], default: "off" },
    /**
     * Hold new joiners at the induction and agreements before letting them in.
     *
     * Off by default, and it must stay off until the four PDFs and the video
     * are uploaded — switching it on first would lock every employee out of
     * the whole application over an administrative gap rather than anything
     * they did. The gate itself is careful about this too: it only blocks on a
     * definite "not signed", never on a failure to work out the answer.
     */
    requireAgreements: { type: Boolean, default: false },
    /**
     * Whether onboarding also requires a face on file.
     *
     * Separate from `requireAgreements` so the gate can be switched on for the
     * paperwork before the cameras are ready — and switched back off without a
     * deploy if the matching service goes down, which would otherwise strand
     * every new joiner at a step nothing can complete.
     */
    requireFaceEnrollment: { type: Boolean, default: false },
    /**
     * Whether a work-from-home punch must carry a real location fix.
     *
     * Only remote staff: office staff punch at a kiosk that has already seen
     * them, so a browser's opinion of where they are adds nothing. For a remote
     * punch it is the only account of where the day started, and an IP address
     * is no substitute — a mobile carrier's addresses resolve to the city its
     * gateway sits in, two hundred kilometres from the handset.
     *
     * Off by default, and reversible without a deploy, because it can refuse a
     * punch: somebody whose phone genuinely cannot get a fix would otherwise
     * have no way to clock in and no way to say so.
     */
    requireRemoteLocation: { type: Boolean, default: false },
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
