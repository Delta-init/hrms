import mongoose, { Schema } from "mongoose";

/**
 * The induction video a new joiner has to watch before signing.
 *
 * `durationSeconds` is measured on the server when the file is uploaded, never
 * taken from the browser. It is the number every completion check is compared
 * against, so a client that could set it could also declare itself finished.
 */
const inductionVideoSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    title: { type: String, trim: true, maxlength: 160, default: "Induction" },
    fileKey: { type: String, required: true, trim: true },
    fileName: { type: String, trim: true, maxlength: 260 },
    durationSeconds: { type: Number, required: true, min: 1 },
    active: { type: Boolean, default: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

export const InductionVideo = mongoose.model("InductionVideo", inductionVideoSchema);
