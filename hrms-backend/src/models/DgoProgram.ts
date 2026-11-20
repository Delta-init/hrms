import mongoose, { Schema } from "mongoose";

/**
 * DGO Points switched on or off for an organisation, and which of its
 * departments count as revenue departments for the 55/45 split.
 *
 * Operational, so not versioned like the settings: a month's budget copies the
 * grouping it was opened with, which is what keeps an earlier month unchanged
 * when a department is moved between groups later.
 */
const dgoProgramSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    /** Off until an admin opens it: until then only staff with a DGO permission, heads and Super Admins see anything. */
    openToEmployees: { type: Boolean, default: false },
    revenueDepartments: { type: [{ type: Schema.Types.ObjectId, ref: "Department" }], default: [] },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

dgoProgramSchema.index({ organization: 1 }, { unique: true });

export const DgoProgram = mongoose.model("DgoProgram", dgoProgramSchema);
