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

const departmentSchema = new Schema<IDepartment>(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      unique: true,
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
    members: {
      type: [memberSchema],
      default: [],
    },
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

export const Department = mongoose.model<IDepartment>("Department", departmentSchema);
