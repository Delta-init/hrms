import mongoose, { Schema } from "mongoose";

/**
 * A record of one backup run — what it captured, and what it did not.
 *
 * The per-collection list is the point of this document. A backup that reports
 * "succeeded" tells you nothing useful; one that says it wrote 63 collections
 * and 9,412 documents, and names the two it could not read, can be checked
 * against yesterday's without downloading anything. A backup nobody can verify
 * is a backup nobody should rely on.
 *
 * Deliberately not scoped to an organisation. A dump is of the whole database,
 * across every tenant, which is also why reading one is Super Admin only.
 */
const collectionEntrySchema = new Schema(
  {
    name: { type: String, required: true },
    documents: { type: Number, default: 0 },
    bytes: { type: Number, default: 0 },
    /** included — written to the archive. skipped/failed — say so, and why. */
    status: { type: String, enum: ["included", "skipped", "failed"], default: "included" },
    reason: { type: String, default: "" },
  },
  { _id: false }
);

const backupSchema = new Schema(
  {
    /** The R2 key of the archive. Empty while a run is still in flight. */
    key: { type: String, default: "" },
    filename: { type: String, default: "" },
    /** Compressed size on disk. */
    bytes: { type: Number, default: 0 },
    status: { type: String, enum: ["running", "complete", "failed"], default: "running", index: true },
    error: { type: String, default: "" },
    /** Scheduled, or somebody pressed the button. */
    trigger: { type: String, enum: ["scheduled", "manual"], default: "scheduled" },
    triggeredBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    collections: { type: [collectionEntrySchema], default: [] },
    totals: {
      collections: { type: Number, default: 0 },
      included: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      documents: { type: Number, default: 0 },
    },
    /** How long it took, so a run that is quietly slowing down is visible. */
    durationMs: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: false, versionKey: false }
);

backupSchema.index({ startedAt: -1 });

export const Backup = mongoose.model("Backup", backupSchema);
