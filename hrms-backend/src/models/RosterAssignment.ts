import mongoose, { Schema } from "mongoose";
import type { IRosterAssignment } from "../types/index.js";

const rosterAssignmentSchema = new Schema<IRosterAssignment>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: [true, "Employee is required"] },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    workSchedule: { type: Schema.Types.ObjectId, ref: "WorkSchedule", required: [true, "Work schedule is required"] },
    effectiveFrom: { type: Date, required: [true, "Start date is required"] },
    effectiveTo: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 300 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

rosterAssignmentSchema.index({ organization: 1, employee: 1, effectiveFrom: -1 });
rosterAssignmentSchema.index({ organization: 1, user: 1, effectiveFrom: -1 });

export const RosterAssignment = mongoose.model<IRosterAssignment>("RosterAssignment", rosterAssignmentSchema);
