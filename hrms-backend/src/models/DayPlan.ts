import mongoose, { Schema } from "mongoose";

/*
 * Day plans (2026-11-26): a person's working day by the clock — first for the office boy, from his job
 * description. HR keeps the routine (DayPlan); each working day he gets his own copy (DayPlanDay) that he ticks,
 * adds to and rearranges. His changes are for that day only: tomorrow starts from the routine again.
 *
 * Times aren't stored on items: they come from the day's start, the order and each item's length (utils/dayPlan).
 */

const routineItem = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    mins: { type: Number, required: true, min: 5, max: 480 },
    steps: { type: [String], default: [] },
    /** "HH:MM" for a fixed time — lunch, closing. */
    fixedAt: { type: String, default: null },
    kind: { type: String, enum: ["task", "break"], default: "task" },
  },
  { _id: true }
);

const dayPlanSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    /** 0 = Monday … 6 = Sunday. */
    weekdays: { type: [Number], default: [0, 1, 2, 3, 4, 5] },
    startAt: { type: String, default: "09:00" },
    /** Office rounds every N minutes from the start; 0 for none. */
    roundEveryMins: { type: Number, default: 60, min: 0, max: 240 },
    items: { type: [routineItem], default: [] },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, versionKey: false }
);

export const DayPlan = mongoose.model("DayPlan", dayPlanSchema);

const dayStep = new Schema({ title: { type: String, required: true }, done: { type: Boolean, default: false }, doneAt: { type: Date, default: null } }, { _id: true });

const dayItem = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    mins: { type: Number, required: true, min: 5, max: 480 },
    steps: { type: [dayStep], default: [] },
    fixedAt: { type: String, default: null },
    kind: { type: String, enum: ["task", "break"], default: "task" },
    /** Its start in the routine as HR set it — "HH:MM"; null for one he added. */
    plannedAt: { type: String, default: null },
    addedByHim: { type: Boolean, default: false },
    /** Added to today by the HR department (2026-11-26). */
    addedByHr: { type: Boolean, default: false },
    done: { type: Boolean, default: false },
    doneAt: { type: Date, default: null },
  },
  { _id: true }
);

const dayPlanDaySchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    plan: { type: Schema.Types.ObjectId, ref: "DayPlan", required: true },
    employee: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    user: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    /** "YYYY-MM-DD" in the office's time zone. */
    date: { type: String, required: true },
    startAt: { type: String, required: true },
    roundEveryMins: { type: Number, default: 60 },
    items: { type: [dayItem], default: [] },
    /** Rounds done, by the round's due time "HH:MM". */
    rounds: { type: [{ due: String, doneAt: Date }], default: [], _id: false },
    history: { type: [{ at: Date, action: String, note: String }], default: [], _id: false },
  },
  { timestamps: true, versionKey: false }
);
dayPlanDaySchema.index({ plan: 1, date: 1 }, { unique: true });

export const DayPlanDay = mongoose.model("DayPlanDay", dayPlanDaySchema);
