import mongoose, { Schema } from "mongoose";
import type { IApprovalWorkflow } from "../types/index.js";

const approvalStepSchema = new Schema(
  {
    order: { type: Number, required: true, min: 1 },
    role: { type: Schema.Types.ObjectId, ref: "Role", required: true },
    label: { type: String, trim: true, maxlength: 60 },
  },
  { _id: false }
);

/** One org's configured multi-step approval chain for an approvable module
 *  (leave / regularization / reimbursements). Steps are snapshotted onto each
 *  record when it's created, so editing this later never changes in-flight
 *  requests — only new ones pick up the change. */
const approvalWorkflowSchema = new Schema<IApprovalWorkflow>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    module: { type: String, enum: ["leave", "regularization", "reimbursements", "confirmations"], required: true },
    enabled: { type: Boolean, default: false },
    steps: { type: [approvalStepSchema], default: [] },
  },
  { timestamps: true, versionKey: false }
);

approvalWorkflowSchema.index({ organization: 1, module: 1 }, { unique: true });

export const ApprovalWorkflow = mongoose.model<IApprovalWorkflow>("ApprovalWorkflow", approvalWorkflowSchema);
