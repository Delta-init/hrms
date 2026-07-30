import mongoose, { Schema } from "mongoose";
import type { ILeavePolicy } from "../types/index.js";

/** A per-org, per-leave-type accrual policy: yearly entitlement, whether it
 *  accrues monthly (pro-rata) or is available in full from the start, and how
 *  many unused days carry into the next year. */
const leavePolicySchema = new Schema<ILeavePolicy>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    type: {
      type: String,
      enum: ["annual", "sick", "casual", "unpaid", "maternity", "paternity", "wfh"],
      required: [true, "Leave type is required"],
    },
    annualDays: { type: Number, required: [true, "Annual entitlement is required"], min: 0 },
    accrueMonthly: { type: Boolean, default: true },
    carryForwardLimit: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, versionKey: false }
);

leavePolicySchema.index({ organization: 1, type: 1 }, { unique: true });

export const LeavePolicy = mongoose.model<ILeavePolicy>("LeavePolicy", leavePolicySchema);
