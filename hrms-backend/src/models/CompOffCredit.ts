import mongoose, { Schema } from "mongoose";
import type { ICompOffCredit } from "../types/index.js";

/** One comp-off "earn" event — an employee worked a weekend/holiday and was
 *  credited a day (or half-day) they can later redeem via a type="comp_off"
 *  leave request. */
const compOffCreditSchema = new Schema<ICompOffCredit>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: [true, "Employee is required"] },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null },
    date: { type: Date, required: [true, "Date worked is required"] },
    amount: { type: Number, required: true, min: 0.5, max: 5 },
    reason: { type: String, trim: true, maxlength: 300 },
    status: { type: String, enum: ["available", "revoked"], default: "available" },
    sourceAttendance: { type: Schema.Types.ObjectId, ref: "Attendance", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false }
);

compOffCreditSchema.index({ organization: 1, employee: 1, date: -1 });
compOffCreditSchema.index({ organization: 1, user: 1, status: 1 });

export const CompOffCredit = mongoose.model<ICompOffCredit>("CompOffCredit", compOffCreditSchema);
