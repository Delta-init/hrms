import { Schema } from "mongoose";

/** Shared subdocument schemas mixed into every approvable model (Leave,
 *  Regularization, Reimbursement) so their multi-step workflow shape stays
 *  identical without duplicating the field definitions three times. */

export const approvalStepSnapshotSchema = new Schema(
  {
    order: { type: Number, required: true },
    role: { type: Schema.Types.ObjectId, ref: "Role", required: true },
    roleName: { type: String, required: true },
    label: { type: String },
  },
  { _id: false }
);

export const approvalTrailEntrySchema = new Schema(
  {
    step: { type: Number, required: true },
    roleName: { type: String },
    by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, enum: ["approved", "rejected"], required: true },
    note: { type: String, trim: true, maxlength: 500 },
    at: { type: Date, required: true },
  },
  { _id: false }
);

/** Spread into a model's schema definition object. */
export const workflowStateFields = {
  workflowStep: { type: Number, default: null },
  workflowTotalSteps: { type: Number, default: null },
  approvalSteps: { type: [approvalStepSnapshotSchema], default: [] },
  approvalTrail: { type: [approvalTrailEntrySchema], default: [] },
};
