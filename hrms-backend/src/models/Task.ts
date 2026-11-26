import mongoose, { Schema } from "mongoose";

/*
 * Tasks HR hands out (2026-11-25, Part 1: one-off tasks).
 *
 * One record is one person's copy: a task given to nine people, or to a department, is nine records sharing a
 * `batch`, so each person ticks their own steps and is approved on their own. Part 2 adds repeating tasks as a
 * series that creates these records; `series` is reserved for that and stays null here.
 *
 *   todo → in_progress (first step ticked) → submitted ("Mark done") → done (approved), or back to in_progress
 *   (sent back). Without approval, Mark done goes straight to done. "Overdue" is not a status: it is dueAt in the
 *   past and the task not done or cancelled.
 */

export const TASK_STATUSES = ["todo", "in_progress", "submitted", "done", "cancelled"] as const;
export const TASK_PRIORITIES = ["urgent", "high", "normal", "low"] as const;

const stepSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    done: { type: Boolean, default: false },
    doneAt: { type: Date, default: null },
  },
  { _id: true }
);

const reviewSchema = new Schema(
  {
    action: { type: String, enum: ["approved", "sent_back"], required: true },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    byName: { type: String, default: "" },
    note: { type: String, trim: true, maxlength: 1000, default: "" },
    at: { type: Date, required: true },
  },
  { _id: false }
);

const historySchema = new Schema(
  {
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    byName: { type: String, default: "" },
    /** assigned · edited · started · submitted · approved · sent_back · cancelled · step_done · step_undone */
    action: { type: String, required: true },
    note: { type: String, default: "" },
    /** The documents handed in with a submission (2026-11-26), by name. */
    files: { type: [String], default: undefined },
  },
  { _id: false }
);

const taskSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    /** Copies created together share this, so the list can show "9 people" as one row. */
    batch: { type: String, required: true, index: true },
    /** The repeating series this copy came from (Part 2), and which of its dates — "YYYY-MM-DD" in office time. */
    series: { type: Schema.Types.ObjectId, ref: "TaskSeries", default: null, index: true },
    occurrenceDate: { type: String, default: null },
    /** Set once the overdue notice has gone, so it goes once. */
    overdueNotifiedAt: { type: Date, default: null },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    details: { type: String, trim: true, maxlength: 4000, default: "" },
    category: { type: Schema.Types.ObjectId, ref: "TaskCategory", default: null },
    priority: { type: String, enum: TASK_PRIORITIES, default: "normal" },
    assignee: { type: Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    /** The assignee's login, so "my tasks" and notices don't need the employee lookup. Null if they have none. */
    assigneeUser: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    /** The department it was given through, when it was given to a department. */
    viaDepartment: { type: Schema.Types.ObjectId, ref: "Department", default: null },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    dueAt: { type: Date, required: true, index: true },
    steps: { type: [stepSchema], default: [] },
    needsApproval: { type: Boolean, default: true },
    proofRequired: { type: Boolean, default: false },
    /** Files HR attached when giving it (2026-11-26) — the same stored files on every person's copy. */
    attachments: { type: [{ key: { type: String, required: true }, name: { type: String, default: "" } }], default: [], _id: false },
    status: { type: String, enum: TASK_STATUSES, default: "todo", index: true },
    submission: {
      note: { type: String, trim: true, maxlength: 2000, default: "" },
      fileKey: { type: String, default: "" },
      fileName: { type: String, default: "" },
      /**
       * Every document handed in (2026-11-26: "submit all your credentials" — several at once), each round's kept: a
       * submission after a send-back adds to these. `fileKey`/`fileName` stay as the first, for older screens.
       */
      files: {
        type: [new Schema({ key: { type: String, required: true }, name: { type: String, default: "" }, at: { type: Date, required: true } }, { _id: false })],
        default: [],
      },
      at: { type: Date, default: null },
    },
    startedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    doneAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    reviews: { type: [reviewSchema], default: [] },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true, versionKey: false }
);

taskSchema.index({ organization: 1, status: 1, dueAt: 1 });
taskSchema.index({ organization: 1, assigneeUser: 1, status: 1 });
// One copy per person per date of a series, however often the job runs.
taskSchema.index({ series: 1, assignee: 1, occurrenceDate: 1 }, { unique: true, partialFilterExpression: { series: { $type: "objectId" } } });

export const Task = mongoose.model("Task", taskSchema);

/** A label for grouping tasks — Sales, Admin, Accounts. */
const categorySchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    color: { type: String, trim: true, maxlength: 20, default: "indigo" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false }
);
categorySchema.index({ organization: 1, name: 1 }, { unique: true });

export const TaskCategory = mongoose.model("TaskCategory", categorySchema);

/*
 * A repeating task (Part 2): the plan that makes a copy for each person on each date it falls due. The people are
 * fixed when it's created (departments expanded then); a leaver's copies simply stop. Editing changes what is made
 * from now on, plus today's untouched copies.
 */
const seriesSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    details: { type: String, trim: true, maxlength: 4000, default: "" },
    category: { type: Schema.Types.ObjectId, ref: "TaskCategory", default: null },
    priority: { type: String, enum: TASK_PRIORITIES, default: "normal" },
    steps: { type: [String], default: [] },
    needsApproval: { type: Boolean, default: true },
    proofRequired: { type: Boolean, default: false },
    /** HR's files, copied onto each day's copy. */
    attachments: { type: [{ key: { type: String, required: true }, name: { type: String, default: "" } }], default: [], _id: false },
    assignees: {
      type: [{ employee: { type: Schema.Types.ObjectId, ref: "Employee" }, user: { type: Schema.Types.ObjectId, ref: "User", default: null }, viaDepartment: { type: Schema.Types.ObjectId, ref: "Department", default: null } }],
      default: [],
      _id: false,
    },
    repeat: {
      kind: { type: String, enum: ["daily", "weekly", "interval"], required: true },
      weekdays: { type: [Number], default: [] },
      everyDays: { type: Number, default: null },
    },
    startDate: { type: String, required: true },
    dueTime: { type: String, default: "18:00" },
    timeZone: { type: String, default: "Asia/Dubai" },
    ends: {
      kind: { type: String, enum: ["count", "date", "never"], default: "never" },
      count: { type: Number, default: null },
      date: { type: String, default: null },
    },
    /** Dates made so far, and the last one — so the job knows where it left off. */
    made: { type: Number, default: 0 },
    lastDate: { type: String, default: null },
    /** After a pause, dates before this are skipped rather than made late. */
    skipBefore: { type: String, default: null },
    state: { type: String, enum: ["active", "paused", "ended"], default: "active", index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    history: {
      type: [{ at: Date, by: { type: Schema.Types.ObjectId, ref: "User", default: null }, byName: String, action: String, note: String }],
      default: [],
      _id: false,
    },
  },
  { timestamps: true, versionKey: false }
);

export const TaskSeries = mongoose.model("TaskSeries", seriesSchema);

/** Marks that a once-a-day notice went for an organisation's day, so a restart can't send it twice. */
const digestSchema = new Schema(
  { organization: { type: Schema.Types.ObjectId, ref: "Organization", default: null }, day: String, kind: String },
  { timestamps: true, versionKey: false }
);
digestSchema.index({ organization: 1, day: 1, kind: 1 }, { unique: true });
export const TaskDigest = mongoose.model("TaskDigest", digestSchema);
