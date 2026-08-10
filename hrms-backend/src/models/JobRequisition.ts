import mongoose, { Schema } from "mongoose";
import type { IJobRequisition } from "../types/index.js";

/**
 * A request to fill a role, and the approvals it has to clear first.
 *
 * Hiring used to start wherever somebody happened to mention it, so there was
 * no record of who asked, what it would cost, or who agreed. This is that
 * record: raised by a manager, priced, and routed through the organization's
 * configured chain before any candidate exists.
 */
const jobRequisitionSchema = new Schema<IJobRequisition>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },

    type: { type: String, enum: ["replacement", "new_headcount"], required: true },
    // Only meaningful for a replacement, and the reason its budget is already
    // accounted for — until the proposed salary goes past what they were paid.
    replacing: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    replacingSalary: { type: Number, default: null },

    title: { type: String, required: true, trim: true, maxlength: 120 },
    department: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    designation: { type: String, trim: true, maxlength: 120 },
    location: { type: String, enum: ["india", "dubai"] },
    employmentType: { type: String, enum: ["full_time", "part_time", "contract", "intern"], default: "full_time" },

    headcount: { type: Number, default: 1, min: 1, max: 999 },
    salaryMin: { type: Number, min: 0 },
    salaryMax: { type: Number, min: 0 },
    currency: { type: String, trim: true, uppercase: true, maxlength: 3, default: "AED" },
    budgetApprovalRequired: { type: Boolean, default: false },

    justification: { type: String, trim: true, maxlength: 2000 },
    targetStartDate: { type: Date, default: null },

    raisedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["draft", "pending", "approved", "rejected", "on_hold", "filled", "cancelled"],
      default: "pending",
      index: true,
    },

    // Snapshotted at creation like every other approvable record, so editing the
    // organization's chain never disturbs a request already in flight.
    workflowStep: { type: Number, default: null },
    workflowTotalSteps: { type: Number, default: null },
    approvalSteps: {
      type: [{ order: Number, role: { type: Schema.Types.ObjectId, ref: "Role" }, roleName: String, label: String }],
      default: [],
      _id: false,
    },
    approvalTrail: {
      type: [{
        step: Number, roleName: String,
        by: { type: Schema.Types.ObjectId, ref: "User" },
        action: String, note: String, at: Date,
      }],
      default: [],
      _id: false,
    },
    reviewNote: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true, versionKey: false }
);

jobRequisitionSchema.index({ organization: 1, status: 1, createdAt: -1 });

export const JobRequisition = mongoose.model<IJobRequisition>("JobRequisition", jobRequisitionSchema);
