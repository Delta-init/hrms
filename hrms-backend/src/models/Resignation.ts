import mongoose, { Schema } from "mongoose";
import type { IResignation } from "../types/index.js";

const resignationSchema = new Schema<IResignation>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: [true, "Employee is required"] },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    resignationDate: { type: Date, required: [true, "Resignation date is required"] },
    noticePeriodDays: { type: Number, min: 0, default: 60 },
    lastWorkingDay: { type: Date, required: [true, "Last working day is required"] },
    reason: { type: String, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "withdrawn", "relieved"],
      default: "pending",
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, versionKey: false }
);

resignationSchema.index({ employee: 1, status: 1 });
resignationSchema.index({ status: 1, lastWorkingDay: 1 });

export const Resignation = mongoose.model<IResignation>("Resignation", resignationSchema);
