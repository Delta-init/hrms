import mongoose, { Schema } from "mongoose";
import type { IVisaSubmission } from "../types/index.js";

/**
 * A visa — or proof that its renewal is under way — sent in by an employee
 * through the "update your visa" popup.
 *
 * Kept apart from the employee record on purpose: what an employee types is
 * not what HR has checked. The expiry date and the scan reach the record, and
 * the expiry warnings built on it, only when HR approves; until then they live
 * here. Every submission stays, approved or returned, so who sent what and who
 * decided is never lost.
 */
const visaSubmissionSchema = new Schema<IVisaSubmission>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["visa", "renewal"], required: true },
    expiryDate: { type: Date, default: null },
    file: {
      key: { type: String, required: true },
      name: { type: String, required: true, trim: true, maxlength: 200 },
      contentType: { type: String, default: "application/octet-stream" },
      size: { type: Number, default: 0 },
    },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    submittedAt: { type: Date, required: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { timestamps: true, versionKey: false }
);

// HR's queue, and each employee's latest.
visaSubmissionSchema.index({ organization: 1, status: 1, submittedAt: -1 });
visaSubmissionSchema.index({ employee: 1, submittedAt: -1 });

export const VisaSubmission = mongoose.model<IVisaSubmission>("VisaSubmission", visaSubmissionSchema);
