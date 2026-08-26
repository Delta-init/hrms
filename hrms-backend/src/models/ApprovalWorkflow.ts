import mongoose, { Schema } from "mongoose";
import type { IApprovalWorkflow } from "../types/index.js";

const approvalStepSchema = new Schema(
  {
    order: { type: Number, required: true, min: 1 },
    // A step that only applies sometimes — a budget sign-off is needed for new
    // headcount and for a replacement that costs more, and is pure friction for
    // a like-for-like backfill. Default keeps every existing step unconditional.
    when: { type: String, enum: ["always", "budget_increase"], default: "always" },
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
    module: { type: String, enum: ["leave", "regularization", "reimbursements", "confirmations", "hiring", "agreements"], required: true },
    enabled: { type: Boolean, default: false },
    steps: { type: [approvalStepSchema], default: [] },
  },
  { timestamps: true, versionKey: false }
);

approvalWorkflowSchema.index({ organization: 1, module: 1 }, { unique: true });

export const ApprovalWorkflow = mongoose.model<IApprovalWorkflow>("ApprovalWorkflow", approvalWorkflowSchema);
