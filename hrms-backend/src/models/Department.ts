import mongoose, { Schema } from "mongoose";
import type { IDepartment, IDepartmentMember } from "../types/index.js";

// Each member points to either an Employee or a User (dynamic ref via `kind`).
const memberSchema = new Schema<IDepartmentMember>(
  {
    kind: { type: String, enum: ["Employee", "User"], required: true },
    ref: { type: Schema.Types.ObjectId, required: true, refPath: "members.kind" },
  },
  { _id: false }
);

/**
 * The same shape as a member, but its own schema because `refPath` names the
 * path literally — pointing co-leaders at "members.kind" would resolve every
 * one of them against the wrong array and quietly populate nothing.
 */
const coLeaderSchema = new Schema<IDepartmentMember>(
  {
    kind: { type: String, enum: ["Employee", "User"], required: true },
    ref: { type: Schema.Types.ObjectId, required: true, refPath: "coLeaders.kind" },
  },
  { _id: false }
);

const departmentSchema = new Schema<IDepartment>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [80, "Name cannot exceed 80 characters"],
    },
    code: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: [12, "Code cannot exceed 12 characters"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [300, "Description cannot exceed 300 characters"],
    },
    // Team leader — Employee or User (dynamic ref via leaderKind).
    leader: {
      type: Schema.Types.ObjectId,
      refPath: "leaderKind",
      default: null,
    },
    leaderKind: {
      type: String,
      enum: ["Employee", "User"],
      default: "Employee",
    },
    /**
     * Further leaders of the same team, equal to `leader` in authority.
     *
     * `leader` stays the primary rather than becoming one entry in a list
     * because two things downstream can only accept a single answer: the org
     * chart is a tree, and `Employee.reportingTo` holds one manager. Co-leads
     * get every approval and the whole team roster; what they do not get is
     * the reporting line pointed at them.
     */
    coLeaders: {
      type: [coLeaderSchema],
      default: [],
    },
    members: {
      type: [memberSchema],
      default: [],
    },
    /**
     * Refuses a mobile sign-in for this department's remote members — office
     * members are unaffected, since being on-site was never the thing this
     * asks about. Not a device lock like the punch-binding feature beside it:
     * a browser's own User-Agent is all this reads, so it is a policy someone
     * can work around with effort, not a wall.
     */
    webOnlyForRemote: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

departmentSchema.index({ organization: 1, name: 1 }, { unique: true });

export const Department = mongoose.model<IDepartment>("Department", departmentSchema);
