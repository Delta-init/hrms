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
 * A policy either covers the whole organization or one work schedule. Shift and
 * office staff rarely earn leave at the same rate, and a single org-wide number
 * forced them to.
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
  },
  { timestamps: true, versionKey: false }
);

// One policy per type per schedule, plus one org-wide fallback (workSchedule
// null). Replaces a unique index on (organization, type) — deployments created
// before this need `bun run repair:leave-policy-index` to drop the old one.
leavePolicySchema.index({ organization: 1, type: 1, workSchedule: 1 }, { unique: true });

export const LeavePolicy = mongoose.model<ILeavePolicy>("LeavePolicy", leavePolicySchema);
