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
  },
  { _id: false }
);

const taskSchema = new Schema(
  {
    organization: { type: Schema.Types.ObjectId, ref: "Organization", index: true, default: null },
    /** Copies created together share this, so the list can show "9 people" as one row. */
    batch: { type: String, required: true, index: true },
    series: { type: Schema.Types.ObjectId, default: null },
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
    status: { type: String, enum: TASK_STATUSES, default: "todo", index: true },
    submission: {
      note: { type: String, trim: true, maxlength: 2000, default: "" },
      fileKey: { type: String, default: "" },
      fileName: { type: String, default: "" },
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
