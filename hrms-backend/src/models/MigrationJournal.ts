import mongoose, { Schema } from "mongoose";

/**
 * What an import changed, so it can be undone.
 *
 * A revert that works by deleting whatever looks imported is not a revert. Two
 * thirds of the GreytHR import is *enrichment* of people who already existed —
 * their department, salary and manager are overwritten, and the values that were
 * there before live nowhere else. Deleting by tag would leave every one of them
 * permanently altered and call it a rollback.
 *
 * So the import writes down what it touched, first: one entry per document, with
 * the whole document as it was. `before: null` means the run created it and
 * reverting deletes it; anything else is restored verbatim.
 *
 * Snapshotting the entire document rather than the changed fields is deliberate.
 * The import edits the same employee from six different phases, and reassembling
 * "which fields did we set overall" at revert time is exactly the kind of
 * bookkeeping that is wrong once and wrong silently.
 */

const migrationJournalSchema = new Schema(
  {
    /** Which run this belongs to — one import, one id. */
    run: { type: String, required: true, index: true },
    migration: { type: String, required: true, trim: true, maxlength: 60 },
    collectionName: { type: String, required: true, trim: true, maxlength: 60 },
    documentId: { type: Schema.Types.ObjectId, required: true },
    /** Null = created by this run. Otherwise the document as it stood before. */
    before: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true, versionKey: false }
);

// One entry per document per run: a document edited by six phases is still one
// thing that was changed once, from one prior state.
migrationJournalSchema.index({ run: 1, collectionName: 1, documentId: 1 }, { unique: true });

export const MigrationJournal = mongoose.model("MigrationJournal", migrationJournalSchema);

/** The header for one import: when it ran, what it did, whether it was undone. */
const migrationRunSchema = new Schema(
  {
    run: { type: String, required: true, unique: true },
    migration: { type: String, required: true, trim: true, maxlength: 60 },
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    organizationName: { type: String, trim: true, maxlength: 120 },
    source: { type: String, trim: true, maxlength: 300 },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
    stats: { type: Schema.Types.Mixed, default: {} },
    created: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    revertedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

export const MigrationRun = mongoose.model("MigrationRun", migrationRunSchema);
