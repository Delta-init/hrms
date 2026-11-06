import mongoose, { Schema } from "mongoose";

/**
 * The video a department head puts up for their team, watched by every new
 * joiner in that department on their second day.
 *
 * One live video per department; uploading another retires the last rather
 * than deleting it, the same as the induction video. Its length is read from
 * the file on upload, never taken from a browser, because that is the number
 * "watched in full" is measured against.
 */
const teamVideoSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    department: { type: Schema.Types.ObjectId, ref: "Department", required: true },
    title: { type: String, trim: true, maxlength: 160, default: "Team video" },
    fileKey: { type: String, required: true, trim: true },
    fileName: { type: String, trim: true, maxlength: 260 },
    durationSeconds: { type: Number, required: true, min: 1 },
    active: { type: Boolean, default: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

teamVideoSchema.index({ organization: 1, department: 1, active: 1 });

export const TeamVideo = mongoose.model("TeamVideo", teamVideoSchema);
