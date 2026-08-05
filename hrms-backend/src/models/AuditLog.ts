import mongoose, { Schema } from "mongoose";
import type { IAuditLog } from "../types/index.js";

/** Append-only record of a sensitive/privileged action (currently impersonation start/end). */
const auditLogSchema = new Schema<IAuditLog>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    action: { type: String, required: true, index: true, trim: true, maxlength: 60 },
    actor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actorName: { type: String, required: true, trim: true, maxlength: 120 },
    target: { type: Schema.Types.ObjectId, ref: "User", default: null },
    targetName: { type: String, trim: true, maxlength: 120, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

auditLogSchema.index({ organization: 1, createdAt: -1 });

export const AuditLog = mongoose.model<IAuditLog>("AuditLog", auditLogSchema);
