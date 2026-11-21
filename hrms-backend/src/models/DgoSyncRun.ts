import mongoose, { Schema } from "mongoose";

/**
 * One run of a DGO Points feed — the nightly sales KPI import from Root's daily
 * tracker, a fetch of monthly achiever figures, a fetch of finance's
 * collections — with what it brought in, who couldn't be paid and why, and
 * what went wrong. The Integrations page reads these; nothing else depends on
 * them, so they are a log, not a record of money.
 */
const dgoSyncRunSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    source: { type: String, enum: ["kpi", "achievers", "collections"], required: true },
    key: { type: String, required: true },
    trigger: { type: String, enum: ["nightly", "manual"], required: true },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    byName: { type: String, default: null },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, default: null },
    ok: { type: Boolean, default: false },
    counts: { type: Schema.Types.Mixed, default: {} },
    unmatched: {
      type: [{ _id: false, email: String, name: String, crm: { type: String, default: null }, achievedPct: { type: Number, default: null }, why: String }],
      default: [],
    },
    errors: { type: [String], default: [] },
    problems: { type: [String], default: [] },
  },
  { timestamps: false, versionKey: false }
);

dgoSyncRunSchema.index({ organization: 1, startedAt: -1 });
dgoSyncRunSchema.index({ organization: 1, source: 1, startedAt: -1 });

export const DgoSyncRun = mongoose.model("DgoSyncRun", dgoSyncRunSchema);
