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

    // The job description, provided either way — typed straight in, or
    // attached as a file. Neither excludes the other: a role can carry a
    // written summary and a formatted brief at once.
    jdText: { type: String, trim: true, maxlength: 20000 },
    jdKey: { type: String, trim: true },
    jdFileName: { type: String, trim: true, maxlength: 200 },

    // What the panel asks, written by whoever needs the role filled — they know
    // what a good answer sounds like; the panel may not. Every round asks all of
    // them, each marked out of its own maximum. Kept editable after approval
    // (see setQuestions), since none of it is what the approvers signed off on;
    // a marked sheet keeps its own copy, so a later edit never rewrites a mark.
    interviewQuestions: {
      type: [{
        question: { type: String, required: true, trim: true, maxlength: 1000 },
        expectedAnswer: { type: String, required: true, trim: true, maxlength: 4000 },
        maxMarks: { type: Number, required: true, min: 1, max: 100 },
      }],
      default: [],
    },
    questionsUpdatedAt: { type: Date, default: null },
    questionsUpdatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },

    raisedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /** How soon it has to be filled. Requisitions from before this have none, and read as normal. */
    priority: { type: String, enum: ["urgent", "high", "normal", "low"], default: "normal", index: true },
    /** The last move between active, closed and cancelled after approval — who and when. */
    stateChangedAt: { type: Date, default: null },
    stateChangedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    status: {
      type: String,
      // finance_pending: HR approved one that needs accounts, and it waits on
      // finance's decision (HIRING_FINANCE_STEP=on) — see review().
      // closed: approved, then no longer recruiting — reopened by setting it
      // active again (see setState). cancelled covers both a withdrawal before
      // any decision (withdrawnAt set) and a cancellation after approval.
      enum: ["draft", "pending", "finance_pending", "approved", "rejected", "on_hold", "filled", "closed", "cancelled"],
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

    // Finance's half, decided in the finance system over the integration API —
    // the same way salary advances are. Finance has no login here, so who
    // decided is the name it sends, kept as text.
    financeReviewedAt: { type: Date, default: null },
    financeNote: { type: String, trim: true, maxlength: 1000, default: "" },
    financeReviewedBy: { type: String, trim: true, maxlength: 120, default: "" },
    rejectedBy: { type: String, enum: ["hr", "finance", null], default: null },
    // Withdrawn before it was decided — the status is "cancelled", these say who and why.
    withdrawnAt: { type: Date, default: null },
    withdrawnBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    withdrawReason: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { timestamps: true, versionKey: false }
);

jobRequisitionSchema.index({ organization: 1, status: 1, createdAt: -1 });

export const JobRequisition = mongoose.model<IJobRequisition>("JobRequisition", jobRequisitionSchema);
