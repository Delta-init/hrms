import mongoose, { Schema } from "mongoose";

/**
 * One new joiner's first fifteen days: the steps they and their department
 * head take, and when each was done.
 *
 * Only for people who join on or after the day this went live
 * (FIRST_DAYS_FROM) — everyone already here has nothing to catch up on, and is
 * never given one. Created on their first day, not when the employee record is
 * made, since HR often adds people weeks ahead.
 *
 * Which steps apply is read when asked rather than frozen here: whether their
 * department is a sales team, and whether it has a team video, are HR's and
 * the head's to change, and a joiner should get the current answer.
 */
const fileSchema = new Schema(
  { key: String, name: String, at: Date, by: { type: Schema.Types.ObjectId, ref: "User", default: null } },
  { _id: false }
);
const tickSchema = new Schema(
  { at: { type: Date, default: null }, by: { type: Schema.Types.ObjectId, ref: "User", default: null } },
  { _id: false }
);

const firstDaysSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    timeZone: { type: String, default: "Asia/Dubai" },
    /** The joining day, and the last of the fifteen — the window the portal is red. */
    startDay: { type: String, required: true },
    endDay: { type: String, required: true },
    /** Working days 1, 2 and 3, as days off and holidays stood when it began. */
    stepDays: { type: [String], default: [] },

    // Day 1, 10:30 to 1 pm: done when both sides have said so.
    session: {
      joinerAt: { type: Date, default: null },
      headAt: { type: Date, default: null },
      headBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    homework: { type: fileSchema, default: null },
    homeworkResult: { type: fileSchema, default: null },
    /** Their progress through the department's team video — the same counting as the induction's. */
    teamVideo: {
      video: { type: Schema.Types.ObjectId, ref: "TeamVideo", default: null },
      spans: { type: [{ from: { type: Number, required: true }, to: { type: Number, required: true }, _id: false }], default: [] },
      lastPosition: { type: Number, default: 0 },
      lastBeatAt: { type: Date, default: null },
      watchedSeconds: { type: Number, default: 0 },
      skipAttempts: { type: Number, default: 0 },
      completedAt: { type: Date, default: null },
    },
    rolePlay: {
      link: { type: String, trim: true, maxlength: 500, default: "" },
      at: { type: Date, default: null },
    },
    // 3CX and Zoho are HR's to give; the sales CRM is the department head's.
    access: {
      threeCx: { type: tickSchema, default: () => ({}) },
      zoho: { type: tickSchema, default: () => ({}) },
      crm: { type: tickSchema, default: () => ({}) },
    },
    coldCalls: {
      assignedAt: { type: Date, default: null },
      assignedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
      doneAt: { type: Date, default: null },
    },
  },
  { timestamps: true, versionKey: false }
);

firstDaysSchema.index({ organization: 1, employee: 1 }, { unique: true });
firstDaysSchema.index({ organization: 1, endDay: 1 });

export const FirstDays = mongoose.model("FirstDays", firstDaysSchema);
