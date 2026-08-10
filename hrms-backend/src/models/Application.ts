import mongoose, { Schema } from "mongoose";
import { APPLICATION_STAGES } from "../types/index.js";
import type { IApplication } from "../types/index.js";

/** One candidate against one requisition, and how far they have got. */
const applicationSchema = new Schema<IApplication>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null, index: true },
    requisition: { type: Schema.Types.ObjectId, ref: "JobRequisition", required: true, index: true },
    candidate: { type: Schema.Types.ObjectId, ref: "Candidate", required: true, index: true },

    stage: { type: String, enum: APPLICATION_STAGES, default: "applied" },
    status: { type: String, enum: ["active", "rejected", "withdrawn"], default: "active", index: true },
    rating: { type: Number, min: 1, max: 5, default: null },
    offeredSalary: { type: Number, min: 0, default: null },
    rejectionReason: { type: String, trim: true, maxlength: 500 },
    movedToEmployee: { type: Schema.Types.ObjectId, ref: "Employee", default: null },

    // Kept rather than derived: "how long did this sit in screening" is the
    // question a hiring process gets judged on, and a single current stage
    // cannot answer it.
    stageHistory: {
      type: [{
        stage: String,
        by: { type: Schema.Types.ObjectId, ref: "User" },
        at: { type: Date, default: Date.now },
        note: String,
      }],
      default: [],
      _id: false,
    },
  },
  { timestamps: true, versionKey: false }
);

// The same person cannot be in the same pipeline twice.
applicationSchema.index({ organization: 1, requisition: 1, candidate: 1 }, { unique: true });

export const Application = mongoose.model<IApplication>("Application", applicationSchema);
