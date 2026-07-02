import mongoose, { Schema } from "mongoose";
import type { IRole, ModulePermissions } from "../types/index.js";
import { HRMS_MODULES } from "../types/index.js";

const modulePermissionsSchema = new Schema<ModulePermissions>(
  {
    view: { type: Boolean, default: false },
    create: { type: Boolean, default: false },
    edit: { type: Boolean, default: false },
    delete: { type: Boolean, default: false },
    approve: { type: Boolean, default: false },
    export: { type: Boolean, default: false },
  },
  { _id: false }
);

// Build permissions map schema dynamically from HRMS_MODULES
const permissionsFields: Record<string, unknown> = {};
for (const mod of HRMS_MODULES) {
  permissionsFields[mod] = { type: modulePermissionsSchema, default: () => ({}) };
}

const roleSchema = new Schema<IRole>(
  {
    roleName: {
      type: String,
      required: [true, "Role name is required"],
      unique: true,
      trim: true,
      maxlength: [50, "Role name cannot exceed 50 characters"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [200, "Description cannot exceed 200 characters"],
    },
    permissions: {
      type: permissionsFields,
      default: {},
    },
    isSystemRole: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// roleName index is created by `unique: true` above

export const Role = mongoose.model<IRole>("Role", roleSchema);
