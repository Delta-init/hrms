import mongoose, { Schema } from "mongoose";
import type { IHoliday } from "../types/index.js";

/** Leave calendar — company / public holidays used when computing attendance. */
const holidaySchema = new Schema<IHoliday>(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    name: {
      type: String,
      required: [true, "Holiday name is required"],
      trim: true,
      maxlength: [120, "Name cannot exceed 120 characters"],
    },
    date: {
      type: Date,
      required: [true, "Date is required"],
    },
    // Region the holiday applies to.
    timeZone: {
      type: String,
      required: [true, "Time zone is required"],
      default: "Asia/Dubai",
      trim: true,
    },
    type: {
      type: String,
      enum: ["public", "company", "optional"],
      default: "public",
    },
    recurring: {
      type: Boolean,
      default: false,
    },
    // Tag: the work schedule (leave calendar) this holiday belongs to. Null = global.
    workSchedule: {
      type: Schema.Types.ObjectId,
      ref: "WorkSchedule",
      default: null,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [300, "Description cannot exceed 300 characters"],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

holidaySchema.index({ date: 1 });
holidaySchema.index({ timeZone: 1, date: 1 });

export const Holiday = mongoose.model<IHoliday>("Holiday", holidaySchema);
