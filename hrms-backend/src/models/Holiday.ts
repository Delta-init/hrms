import mongoose, { Schema } from "mongoose";
import type { IHoliday } from "../types/index.js";

/**
 * Leave calendar — company / public holidays used when computing attendance.
 *
 * A holiday is not automatically everybody's. Staff working from home in Kerala
 * keep a different calendar from staff in the Dubai office, and a day off for
 * one is an ordinary working day for the other — so a holiday says who it is
 * for, and every reader has to ask.
 */
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
    /**
     * Whose calendar this belongs to. Null is everybody's.
     *
     * Null on purpose for every holiday written before this existed: they were
     * created when a holiday meant the whole organisation, and that is still
     * what they mean. Nothing changes for them.
     */
    workMode: {
      type: String,
      enum: ["office", "wfh", null],
      default: null,
      index: true,
    },
    /**
     * True where the date is expected to move — an Islamic holiday set by moon
     * sighting, say. Stored so the calendar can say so rather than presenting a
     * date somebody plans around and is then surprised by.
     */
    provisional: {
      type: Boolean,
      default: false,
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
