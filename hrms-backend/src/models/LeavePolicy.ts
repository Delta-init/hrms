import mongoose, { Schema } from "mongoose";
import type { ILeavePolicy } from "../types/index.js";

/**
 * Everything the organization decides about one kind of leave: how much of it
 * somebody gets, over what period, whether taking it costs pay, and what
 * happens to what they don't use.
 *
 * This used to be two records. The work schedule carried a monthly allowance
 * and the paid/unpaid flag, while a separate policy carried the yearly
 * entitlement and carry-forward — so the same question had two answers and
 * nothing kept them agreeing. They are one record now.
 *
 * A policy covers the whole organization, one work schedule, or one work mode.
 * Shift and office staff rarely earn leave at the same rate, and a single
 * org-wide number forced them to.
 *
 * Work mode is a second axis rather than more of the first, because the two do
 * not line up: two of the twelve schedules in use carry both office and remote
 * staff, and remote staff are spread across five of them. "Every remote
 * employee" is not expressible as a set of schedules — it would miss some and
 * sweep in office staff with the rest.
 */
const leavePolicySchema = new Schema<ILeavePolicy>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    /**
     * Open slug rather than a fixed list: an organization can name leave the
     * built-in set doesn't cover, which is what `label` is for.
     */
    type: {
      type: String,
      required: [true, "Leave type is required"],
      trim: true,
      lowercase: true,
      maxlength: 40,
      match: /^[a-z0-9_]+$/,
    },
    /** Display name for a type the built-in list doesn't cover. */
    label: { type: String, trim: true, maxlength: 60 },
    /** The schedule this applies to, or null for everyone in the organization. */
    workSchedule: { type: Schema.Types.ObjectId, ref: "WorkSchedule", default: null, index: true },
    /**
     * Office or remote staff, or null for both.
     *
     * Beats `workSchedule` when somebody matches a policy on each: picking
     * "all remote staff" has to reach every remote employee whatever shift they
     * are on, or it does not mean what it says.
     */
    workMode: { type: String, enum: ["office", "wfh", null], default: null, index: true },
    /** How many days `period` grants. */
    days: { type: Number, required: [true, "Entitlement is required"], min: 0, max: 366 },
    /** Whether `days` is granted each month or each year. */
    period: { type: String, enum: ["month", "year"], default: "year" },
    /** Unpaid leave becomes Loss of Pay on the payslip; paid leave does not. */
    paid: { type: Boolean, default: true },
    /**
     * Months of service before this leave can be taken at all. 0 = from day
     * one. Counted from the employee's joining date, so an entitlement that
     * only opens up after probation is a number here rather than a rule
     * somebody has to remember.
     */
    eligibleAfterMonths: { type: Number, default: 0, min: 0, max: 600 },
    /** Yearly only: max unused days carried into the next year (0 = none). */
    carryForwardLimit: { type: Number, default: 0, min: 0 },
    /**
     * When this policy started governing. Null means it always has.
     *
     * Balances are computed from policies rather than stored, so without this a
     * policy saved today silently rewrites the whole year — including leave
     * already taken, approved and paid. Stamped on creation; existing rows keep
     * null and behave exactly as they did.
     */
    effectiveFrom: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

// One policy per type per target: per schedule, per work mode, and one
// org-wide fallback with both null. Replaces a unique index on
// (organization, type, workSchedule) — deployments created before this need
// `bun run repair:leave-policy-index` to drop the old one, which would
// otherwise refuse a work-mode policy for a type that already has one.
leavePolicySchema.index({ organization: 1, type: 1, workSchedule: 1, workMode: 1 }, { unique: true });

export const LeavePolicy = mongoose.model<ILeavePolicy>("LeavePolicy", leavePolicySchema);
