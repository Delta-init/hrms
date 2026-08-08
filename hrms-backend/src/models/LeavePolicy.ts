import mongoose, { Schema } from "mongoose";
import type { ILeavePolicy } from "../types/index.js";

/** A per-leave-type accrual policy: yearly entitlement, whether it accrues
 *  monthly (pro-rata) or is available in full from the start, and how many
 *  unused days carry into the next year.
 *
 *  A policy either covers the whole organization or one work schedule. Shift
 *  and office staff rarely earn leave at the same rate, and a single org-wide
 *  number forced them to. */
const leavePolicySchema = new Schema<ILeavePolicy>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    type: {
      type: String,
      enum: ["annual", "sick", "casual", "unpaid", "maternity", "paternity", "wfh"],
      required: [true, "Leave type is required"],
    },
    /** The schedule this applies to, or null for everyone in the organization. */
    workSchedule: { type: Schema.Types.ObjectId, ref: "WorkSchedule", default: null, index: true },
    annualDays: { type: Number, required: [true, "Annual entitlement is required"], min: 0 },
    accrueMonthly: { type: Boolean, default: true },
    carryForwardLimit: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, versionKey: false }
);

// One policy per type per schedule, plus one org-wide fallback (workSchedule
// null). Replaces a unique index on (organization, type) — deployments created
// before this need `bun run repair:leave-policy-index` to drop the old one.
leavePolicySchema.index({ organization: 1, type: 1, workSchedule: 1 }, { unique: true });

export const LeavePolicy = mongoose.model<ILeavePolicy>("LeavePolicy", leavePolicySchema);
