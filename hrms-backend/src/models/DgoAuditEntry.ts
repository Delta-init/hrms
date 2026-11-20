import mongoose, { Schema } from "mongoose";

/**
 * Who changed what in DGO Points, with the record before and after. Insert-only,
 * like the ledger: HRMS's own AuditLog keeps a one-line detail, too small for a
 * settings version or a budget figure.
 */
const dgoAuditEntrySchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null },
    actor: { type: Schema.Types.ObjectId, ref: "User", default: null },
    actorName: { type: String, default: null },
    action: { type: String, required: true, maxlength: 60 },
    entity: { type: String, required: true, maxlength: 60 },
    entityId: { type: String, default: null },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    correlationId: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

dgoAuditEntrySchema.index({ organization: 1, createdAt: -1 });
dgoAuditEntrySchema.index({ organization: 1, action: 1, createdAt: -1 });

const refuse = () => {
  throw Object.assign(new Error("DGO audit entries are never changed or deleted"), { statusCode: 409 });
};
dgoAuditEntrySchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne", "deleteMany", "findOneAndDelete"],
  refuse
);
dgoAuditEntrySchema.pre("deleteOne", { document: true, query: true }, refuse);
dgoAuditEntrySchema.pre("save", function () {
  if (!this.isNew) refuse();
});

export const DgoAuditEntry = mongoose.model("DgoAuditEntry", dgoAuditEntrySchema);
