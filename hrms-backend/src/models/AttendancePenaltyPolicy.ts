import mongoose, { Schema } from "mongoose";
import type { IAttendancePenaltyPolicy } from "../types/index.js";

/** One policy per org: the first `graceLates` late arrivals in a month carry
 *  no consequence; every further `lateBlockSize` late arrivals convert into
 *  one half-day Loss-of-Pay, folded into the same LOP deduction payroll uses. */
const attendancePenaltyPolicySchema = new Schema<IAttendancePenaltyPolicy>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    enabled: { type: Boolean, default: false },
    graceLates: { type: Number, required: true, min: 0, max: 31, default: 3 },
    lateBlockSize: { type: Number, required: true, min: 1, max: 31, default: 3 },
    /**
     * Whether a working day with no attendance and no leave is unpaid.
     *
     * Off by default, and deliberately so: a missing record usually means
     * nobody ran attendance that day, not that the person stayed home, and
     * docking pay for a gap in the data is far worse than paying through it.
     * Organizations that do treat attendance as mandatory can turn it on.
     */
    unrecordedDaysUnpaid: { type: Boolean, default: false },
    /**
     * What a regularization proposes by default.
     *
     * Most organizations correct a day to "present", but one that tracks
     * on-site work separately may want every correction to start as work from
     * home. The request still carries its own choice; this only decides what
     * the form opens with.
     */
    defaultRegularizationStatus: {
      type: String,
      enum: ["present", "half_day", "wfh"],
      default: "present",
    },
    /**
     * How many corrections a person may raise in a month before their manager
     * has to sign it off.
     *
     * Not a cap. Somebody who genuinely forgot to punch out four times still
     * gets their day corrected — the fourth request simply stops being a
     * formality and goes to the person who would know. A hard block would only
     * teach people to stop asking, which loses the attendance record rather
     * than fixing the habit.
     */
    monthlyRegularizationLimit: { type: Number, required: true, min: 0, max: 31, default: 3 },
  },
  { timestamps: true, versionKey: false }
);

attendancePenaltyPolicySchema.index({ organization: 1 }, { unique: true });

export const AttendancePenaltyPolicy = mongoose.model<IAttendancePenaltyPolicy>(
  "AttendancePenaltyPolicy",
  attendancePenaltyPolicySchema
);
