import mongoose, { Schema } from "mongoose";

/**
 * What somebody's job used to be.
 *
 * The employee record holds only the current department, designation, location,
 * shift and manager, which answers "where are they now" and nothing else. It
 * cannot answer "how long have they been in Sales", "when did they last get a
 * new title", or "who did they report to in 2024" — and those are the questions
 * an HR system gets asked when somebody is up for a review, a visa renewal or a
 * dispute about a promotion date.
 *
 * One collection for every kind of change rather than a column per kind: they
 * all have the same shape (a value, a from, an open-ended to) and a new kind
 * would otherwise mean a new migration.
 *
 * A row with `to: null` is the current one. Rows are not deleted when something
 * changes — the previous row is closed off with a `to` and a new one opened,
 * which is the whole point.
 */

export const HISTORY_KINDS = [
  "company", "department", "designation", "location", "shift",
  "currency", "team", "weekoff", "biometric", "desktopAccess", "manager",
] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

const employmentHistorySchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    kind: { type: String, enum: HISTORY_KINDS, required: true },
    /** The value as a person would read it — "Sales", "Dubai", "web developer". */
    value: { type: String, required: true, trim: true, maxlength: 200 },
    /** Resolved where we can, so the history survives a department being renamed. */
    department: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    manager: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    from: { type: Date, required: true },
    /** Null means this is the current one. */
    to: { type: Date, default: null },
    /** Where the row came from, so an import can be told apart from live changes. */
    source: { type: String, trim: true, maxlength: 40, default: "system" },
  },
  { timestamps: true, versionKey: false }
);

// Re-running an import must not double the history, and the same person cannot
// start the same designation twice on the same day.
employmentHistorySchema.index(
  { organization: 1, employee: 1, kind: 1, value: 1, from: 1 },
  { unique: true }
);
employmentHistorySchema.index({ employee: 1, kind: 1, from: -1 });

export const EmploymentHistory = mongoose.model("EmploymentHistory", employmentHistorySchema);
