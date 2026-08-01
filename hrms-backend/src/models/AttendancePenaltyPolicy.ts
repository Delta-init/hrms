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
  },
  { timestamps: true, versionKey: false }
);

attendancePenaltyPolicySchema.index({ organization: 1 }, { unique: true });

export const AttendancePenaltyPolicy = mongoose.model<IAttendancePenaltyPolicy>(
  "AttendancePenaltyPolicy",
  attendancePenaltyPolicySchema
);
