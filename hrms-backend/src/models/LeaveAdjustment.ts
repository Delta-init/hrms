import mongoose, { Schema } from "mongoose";

/**
 * A correction to somebody's leave balance that the rules cannot derive.
 *
 * Balances here are computed, not stored: accrued plus carried forward minus
 * used. That is the right model — it cannot drift out of step with the leave
 * actually taken — but it leaves no way to say "regardless of the arithmetic,
 * this person starts with fourteen days", which is exactly what an import from
 * another system needs, and what HR needs the first time somebody is owed days
 * for a reason no policy describes.
 *
 * So the balance becomes accrued + carried + adjustments − used.
 *
 * A migration writes the *difference* between the old system's figure and what
 * this one computes, not the old figure itself. Writing the figure would double
 * it against our own accrual. The difference makes the balance match on the day
 * of the cutover and behave by our rules from then on, and the reason on each
 * row says where it came from — an unexplained thirty days appearing in
 * somebody's balance is worse than no import at all.
 *
 * Negative days are allowed and meaningful: ninety-two of the balances in the
 * first import were already overdrawn.
 */
const leaveAdjustmentSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    /** Keyed on the login, like leave requests, since that is what balances are computed for. */
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    /** Matches LeavePolicy.type — "annual", "sick", "comp_off". */
    type: { type: String, required: true, trim: true, lowercase: true, maxlength: 40 },
    /** The year the adjustment applies to; a yearly balance is read per year. */
    year: { type: Number, required: true, min: 2000, max: 2200 },
    /** Positive credits days, negative removes them. */
    days: { type: Number, required: true },
    reason: { type: String, trim: true, maxlength: 300 },
    /** Set by an import so its rows can be told from a human's correction. */
    source: { type: String, trim: true, maxlength: 40, default: "manual" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

// One adjustment per person, per leave type, per year, per source: re-running
// an import corrects its own row rather than stacking another on top.
leaveAdjustmentSchema.index(
  { organization: 1, user: 1, type: 1, year: 1, source: 1 },
  { unique: true }
);

export const LeaveAdjustment = mongoose.model("LeaveAdjustment", leaveAdjustmentSchema);
