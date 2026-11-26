import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { Task, TaskCategory } from "../models/Task.js";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { Organization } from "../models/Organization.js";
import { scoped, getOrgId } from "../utils/orgContext.js";
import { searchRegex } from "../utils/query.js";
import { stillHere } from "../utils/employeeStatus.js";
import { todayInTz, zonedTimeToUtc } from "../utils/schedule.js";
import { notify } from "./notificationService.js";
import { emailTaskAssigned, emailSentBack } from "./taskEmail.js";
import { watchersFor } from "./watchers.js";
import { publicUrl } from "./uploadService.js";
import type { CreateTaskInput, UpdateTaskInput, ListTaskQuery, CategoryInput } from "../validations/taskValidation.js";

/*
 * Tasks HR hands out — Part 1, one-off tasks (the user, 2026-11-25). See models/Task.ts for the lifecycle.
 *
 *   assign      HR (tasks:create) to people and/or departments; a department is expanded to the people in it now
 *   work        the assignee ticks steps; the first tick starts it
 *   mark done   all steps ticked, or a note saying why not; a proof file when HR asked for one
 *   review      tasks:approve approves or sends back with a reason — never their own task
 */

const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });
const OPEN = ["todo", "in_progress", "submitted"];

const POP = [
  { path: "assignee", select: "name employeeCode designation department" },
  { path: "assignedBy", select: "name" },
  { path: "category", select: "name color" },
  { path: "viaDepartment", select: "name" },
  { path: "series", select: "repeat state" },
];

async function nameOf(userId: string) {
  const u = await User.findById(userId).select("name").lean<{ name?: string } | null>();
  return String(u?.name ?? "");
}

/** Today's bounds in the organisation's time zone — "due today" means today where the office is. */
async function todayBounds(now = new Date()) {
  const org = await Organization.findById(getOrgId()).select("settings.timeZone").lean<{ settings?: { timeZone?: string } } | null>();
  const tz = org?.settings?.timeZone || "Asia/Dubai";
  const today = todayInTz(tz, now);
  const start = zonedTimeToUtc(today, "00:00", tz);
  return { tz, start, end: new Date(start.getTime() + 86_400_000) };
}

/** A task as the API hands it out: the proof file as a short-lived link, and whether it's late. */
function shape(t: Record<string, unknown>, now = new Date()): Record<string, unknown> & { status: string } {
  const sub = (t.submission ?? {}) as { fileKey?: string; fileName?: string; note?: string; at?: Date | null; files?: Array<{ key: string; name?: string; at?: Date }> };
  // Every document handed in; a task from before keeps its one file.
  const files = sub.files?.length ? sub.files : sub.fileKey ? [{ key: sub.fileKey, name: sub.fileName ?? "", at: sub.at ?? undefined }] : [];
  const steps = (t.steps ?? []) as Array<{ done?: boolean }>;
  const status = String(t.status);
  return {
    ...t,
    status,
    submission: {
      note: sub.note ?? "", fileName: sub.fileName ?? "", fileUrl: sub.fileKey ? publicUrl(sub.fileKey) : "", at: sub.at ?? null,
      files: files.map((f) => ({ name: f.name || "Document", url: publicUrl(f.key), at: f.at ?? null })),
    },
    attachments: ((t.attachments ?? []) as Array<{ key: string; name?: string }>).map((a) => ({ name: a.name || "File", url: publicUrl(a.key) })),
    progress: { done: steps.filter((s) => s.done).length, total: steps.length },
    overdue: OPEN.includes(status) && status !== "submitted" && new Date(t.dueAt as string) < now,
  };
}

function log(task: InstanceType<typeof Task>, action: string, by: string | null, byName: string, note = "", files?: string[]) {
  task.history.push({ at: new Date(), by: by as never, byName, action, note, ...(files?.length ? { files } : {}) } as never);
}

/**
 * Who a task is for: the chosen people, plus everyone in the chosen departments now. Leavers are skipped; a
 * department picked alongside one of its own people doesn't give that person two copies.
 */
export async function resolvePeople(employees: string[], departments: string[]) {
  const picked = employees.length
    ? await Employee.find(scoped({ _id: { $in: employees }, status: stillHere() })).select("_id user").lean<Array<{ _id: Types.ObjectId; user?: Types.ObjectId | null }>>()
    : [];
  if (picked.length !== new Set(employees).size) throw fail("Some of the people chosen weren't found or have left", 400);
  const viaDept = new Map<string, string>();
  const fromDepts = departments.length
    ? await Employee.find(scoped({ department: { $in: departments }, status: stillHere() })).select("_id user department").lean<Array<{ _id: Types.ObjectId; user?: Types.ObjectId | null; department?: Types.ObjectId }>>()
    : [];
  for (const e of fromDepts) viaDept.set(String(e._id), String(e.department));
  const people = new Map<string, { _id: Types.ObjectId; user?: Types.ObjectId | null }>();
  for (const e of [...picked, ...fromDepts]) people.set(String(e._id), e);
  if (!people.size) throw fail("Nobody to give it to — the departments chosen have no current staff", 400);
  for (const e of picked) viaDept.delete(String(e._id));
  return { people, viaDept };
}

export { nameOf, todayBounds, fail as taskFail };

export class TaskService {
  // ── Categories ────────────────────────────────────────────────────────────
  async categories(includeInactive = false) {
    return TaskCategory.find(scoped(includeInactive ? {} : { active: true })).sort({ name: 1 }).lean();
  }

  async createCategory(input: CategoryInput) {
    if (await TaskCategory.exists(scoped({ name: new RegExp(`^${input.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }))) {
      throw fail("There's already a category with that name", 409);
    }
    return TaskCategory.create({ organization: getOrgId(), name: input.name, color: input.color ?? "indigo" });
  }

  async updateCategory(id: string, input: Partial<CategoryInput>) {
    const c = await TaskCategory.findOne(scoped({ _id: id }));
    if (!c) throw fail("Category not found", 404);
    Object.assign(c, input);
    await c.save();
    return c;
  }

  // ── Assign ────────────────────────────────────────────────────────────────
  /** One copy per person: the chosen people, plus everyone in the chosen departments now. Leavers are skipped. */
  async create(input: CreateTaskInput, actorId: string, attachments: Array<{ key: string; name: string }> = []) {
    if (input.category && !(await TaskCategory.exists(scoped({ _id: input.category })))) throw fail("Category not found", 404);
    // Repeating: a series that makes the copies, date by date (Part 2).
    if (input.repeat && input.repeat.kind !== "once") {
      const { createSeries } = await import("./taskSeriesService.js");
      return createSeries(input, actorId, attachments);
    }
    const { people, viaDept } = await resolvePeople(input.employees, input.departments);
    const byName = await nameOf(actorId);
    const batch = randomUUID();
    const now = new Date();
    const docs = [...people.values()].map((e) => ({
      organization: getOrgId(),
      batch,
      title: input.title,
      details: input.details ?? "",
      category: input.category ?? null,
      priority: input.priority,
      assignee: e._id,
      assigneeUser: e.user ?? null,
      viaDepartment: viaDept.get(String(e._id)) ?? null,
      assignedBy: actorId,
      dueAt: input.dueAt,
      steps: input.steps.map((title) => ({ title })),
      needsApproval: input.needsApproval,
      proofRequired: input.proofRequired,
      attachments,
      history: [{ at: now, by: actorId, byName, action: "assigned", note: "" }],
    }));
    const created = await Task.insertMany(docs);

    const due = input.dueAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    await notify({
      users: docs.map((d) => d.assigneeUser).filter(Boolean),
      kind: "reminder",
      title: `New task: ${input.title}`,
      body: `From ${byName || "HR"} · due ${due}`,
      href: "/tasks",
      actor: actorId,
    });
    // The task itself by email, in the background (2026-11-26).
    await emailTaskAssigned(
      [...people.values()].map((e) => ({ user: e.user, employee: e._id })),
      { title: input.title, details: input.details, category: input.category, priority: input.priority, steps: input.steps, needsApproval: input.needsApproval, proofRequired: input.proofRequired, dueAt: input.dueAt, attachments: attachments.length },
      byName, getOrgId(),
    );
    return { batch, created: created.length, series: null as string | null };
  }

  // ── Read ──────────────────────────────────────────────────────────────────
  async list(q: ListTaskQuery, viewerUserId: string) {
    const filter: Record<string, unknown> = scoped({});
    if (q.scope === "mine") filter.assigneeUser = new Types.ObjectId(viewerUserId);
    if (q.scope === "assigned_by_me") filter.assignedBy = new Types.ObjectId(viewerUserId);
    if (q.scope === "waiting") filter.status = "submitted";
    if (q.status) filter.status = q.status;
    if (q.open === "true") filter.status = { $in: OPEN };
    if (q.overdue === "true") { filter.status = { $in: ["todo", "in_progress"] }; filter.dueAt = { $lt: new Date() }; }
    if (q.category) filter.category = q.category;
    if (q.assignee) filter.assignee = q.assignee;
    if (q.department) filter.viaDepartment = q.department;
    if (q.series) filter.series = q.series;
    if (q.dueFrom || q.dueTo) {
      filter.dueAt = { ...(filter.dueAt as object ?? {}), ...(q.dueFrom ? { $gte: q.dueFrom } : {}), ...(q.dueTo ? { $lt: q.dueTo } : {}) };
    }
    if (q.search) {
      const rx = searchRegex(q.search);
      const who = await Employee.find(scoped({ name: rx })).select("_id").limit(50).lean();
      filter.$or = [{ title: rx }, { assignee: { $in: who.map((w) => w._id) } }];
    }
    const skip = (q.page - 1) * q.limit;
    const [rows, total] = await Promise.all([
      Task.find(filter).populate(POP).sort(q.scope === "mine" ? { status: 1, dueAt: 1 } : { dueAt: 1, createdAt: -1 })
        .skip(skip).limit(q.limit).select("-history").lean(),
      Task.countDocuments(filter),
    ]);
    const now = new Date();
    return { records: rows.map((r) => shape(r as Record<string, unknown>, now)), total, page: q.page, limit: q.limit };
  }

  /** One task, with its history. The assignee, or anyone with tasks:view. */
  async get(id: string, viewer: { userId: string; canView: boolean }) {
    const t = await Task.findOne(scoped({ _id: id })).populate(POP).lean();
    if (!t) throw fail("Task not found", 404);
    if (!viewer.canView && String(t.assigneeUser) !== viewer.userId) throw fail("Task not found", 404);
    return shape(t as Record<string, unknown>);
  }

  /** HR's numbers for the top of the page. */
  async summary() {
    const { start, end } = await todayBounds();
    const now = new Date();
    const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
    const base = scoped({});
    const [dueToday, overdue, waiting, doneThisMonth] = await Promise.all([
      Task.countDocuments({ ...base, status: { $in: OPEN }, dueAt: { $gte: start, $lt: end } }),
      Task.countDocuments({ ...base, status: { $in: ["todo", "in_progress"] }, dueAt: { $lt: now } }),
      Task.countDocuments({ ...base, status: "submitted" }),
      Task.find({ ...base, status: "done", doneAt: { $gte: monthStart } }).select("doneAt submittedAt dueAt").lean(),
    ]);
    const onTime = doneThisMonth.filter((t) => new Date((t.submittedAt ?? t.doneAt) as Date) <= new Date(t.dueAt as Date)).length;
    return { dueToday, overdue, waiting, doneThisMonth: doneThisMonth.length, onTimeRate: doneThisMonth.length ? Math.round((onTime / doneThisMonth.length) * 100) : null };
  }

  /** The caller's own numbers — the sidebar badge and the dashboard card. */
  async mySummary(userId: string) {
    const { start, end } = await todayBounds();
    const me = { ...scoped({}), assigneeUser: new Types.ObjectId(userId) };
    const [dueToday, overdue, sentBack, open] = await Promise.all([
      Task.countDocuments({ ...me, status: { $in: ["todo", "in_progress"] }, dueAt: { $gte: start, $lt: end } }),
      Task.countDocuments({ ...me, status: { $in: ["todo", "in_progress"] }, dueAt: { $lt: new Date() } }),
      Task.countDocuments({ ...me, status: "in_progress", "reviews.0": { $exists: true }, $expr: { $eq: [{ $arrayElemAt: ["$reviews.action", -1] }, "sent_back"] } }),
      Task.countDocuments({ ...me, status: { $in: ["todo", "in_progress"] } }),
    ]);
    return { dueToday, overdue, sentBack, open, attention: dueToday + overdue + sentBack };
  }

  // ── HR changes ────────────────────────────────────────────────────────────
  async update(id: string, input: UpdateTaskInput, actorId: string) {
    const t = await Task.findOne(scoped({ _id: id }));
    if (!t) throw fail("Task not found", 404);
    if (t.status === "done" || t.status === "cancelled") throw fail(`This task is ${t.status} and can't be changed`, 400);
    if (input.category && !(await TaskCategory.exists(scoped({ _id: input.category })))) throw fail("Category not found", 404);
    const { steps, ...rest } = input;
    if (steps) {
      if (t.steps.some((s) => s.done)) throw fail("Steps can't be changed once one has been ticked", 400);
      t.set("steps", steps.map((title) => ({ title })));
    }
    Object.assign(t, rest);
    log(t, "edited", actorId, await nameOf(actorId));
    await t.save();
    return this.get(id, { userId: actorId, canView: true });
  }

  async cancel(id: string, note: string | undefined, actorId: string) {
    const t = await Task.findOne(scoped({ _id: id }));
    if (!t) throw fail("Task not found", 404);
    if (t.status === "done" || t.status === "cancelled") throw fail(`This task is already ${t.status}`, 400);
    t.status = "cancelled";
    t.cancelledAt = new Date();
    log(t, "cancelled", actorId, await nameOf(actorId), note ?? "");
    await t.save();
    if (t.assigneeUser) {
      await notify({ users: [t.assigneeUser], kind: "reminder", title: `Task cancelled: ${t.title}`, body: note || "No longer needed", href: "/tasks", actor: actorId });
    }
    return this.get(id, { userId: actorId, canView: true });
  }

  // ── The assignee's side ───────────────────────────────────────────────────
  private async mine(id: string, userId: string) {
    const t = await Task.findOne(scoped({ _id: id }));
    if (!t || String(t.assigneeUser) !== userId) throw fail("Task not found", 404);
    return t;
  }

  async toggleStep(id: string, stepId: string, done: boolean, userId: string) {
    const t = await this.mine(id, userId);
    if (!["todo", "in_progress"].includes(t.status)) {
      throw fail(t.status === "submitted" ? "It's waiting for approval — steps are locked until HR decides" : `This task is ${t.status}`, 400);
    }
    const step = t.steps.find((s) => String(s._id) === stepId);
    if (!step) throw fail("Step not found", 404);
    step.done = done;
    step.doneAt = done ? new Date() : null;
    const name = await nameOf(userId);
    if (t.status === "todo" && done) {
      t.status = "in_progress";
      t.startedAt = new Date();
      log(t, "started", userId, name);
    }
    log(t, done ? "step_done" : "step_undone", userId, name, step.title);
    await t.save();
    return this.get(id, { userId, canView: false });
  }

  /** Mark done. Every step ticked, or a note saying why not; a proof file when HR asked for one. */
  async submit(id: string, input: { note?: string; files?: Array<{ key: string; name: string }> }, userId: string) {
    const t = await this.mine(id, userId);
    if (!["todo", "in_progress"].includes(t.status)) {
      throw fail(t.status === "submitted" ? "It's already waiting for approval" : `This task is ${t.status}`, 400);
    }
    const note = (input.note ?? "").trim();
    const openSteps = t.steps.filter((s) => !s.done).length;
    if (openSteps && note.length < 3) throw fail(`${openSteps} step${openSteps === 1 ? " isn't" : "s aren't"} ticked — tick them, or add a note saying why`, 400);
    const added = input.files ?? [];
    const before = (t.submission?.files ?? []) as unknown as Array<{ key: string; name: string; at: Date }>;
    const old = !before.length && t.submission?.fileKey ? [{ key: t.submission.fileKey, name: t.submission.fileName ?? "", at: t.submission.at ?? new Date() }] : [];
    if (t.proofRequired && !added.length && !before.length && !old.length) throw fail("This task needs a photo or file as proof", 400);

    const now = new Date();
    // Each round's documents are kept: one handed in before a send-back stays, the new ones join it.
    const files = [...old, ...before, ...added.map((f) => ({ key: f.key, name: f.name, at: now }))];
    t.submission = {
      note,
      fileKey: files[0]?.key ?? "",
      fileName: files[0]?.name ?? "",
      files,
      at: now,
    } as never;
    t.submittedAt = now;
    if (!t.startedAt) t.startedAt = now;
    const name = await nameOf(userId);
    if (t.needsApproval) {
      t.status = "submitted";
      log(t, "submitted", userId, name, note, added.map((f) => f.name));
    } else {
      t.status = "done";
      t.doneAt = now;
      log(t, "done", userId, name, note, added.map((f) => f.name));
    }
    await t.save();

    if (t.needsApproval) {
      const approvers = await watchersFor("tasks", userId, "approve");
      await notify({
        users: [...approvers, t.assignedBy],
        kind: "approval",
        title: `Task done, waiting for approval: ${t.title}`,
        body: name ? `By ${name}` : undefined,
        href: "/tasks?tab=waiting",
        actor: userId,
      });
    }
    return this.get(id, { userId, canView: false });
  }

  // ── Review ────────────────────────────────────────────────────────────────
  async review(id: string, decision: "approve" | "send_back", note: string | undefined, actorId: string) {
    const t = await Task.findOne(scoped({ _id: id }));
    if (!t) throw fail("Task not found", 404);
    if (String(t.assigneeUser) === actorId) throw fail("You can't approve your own task", 403);
    if (t.status !== "submitted") throw fail(t.status === "done" ? "It's already approved" : "It isn't waiting for approval", 400);
    if (decision === "send_back" && (note ?? "").trim().length < 3) throw fail("Say what needs doing again", 400);
    const now = new Date();
    const byName = await nameOf(actorId);
    const approve = decision === "approve";
    t.reviews.push({ action: approve ? "approved" : "sent_back", by: actorId, byName, note: note ?? "", at: now } as never);
    if (approve) { t.status = "done"; t.doneAt = now; }
    else t.status = "in_progress";
    log(t, approve ? "approved" : "sent_back", actorId, byName, note ?? "");
    await t.save();

    if (t.assigneeUser) {
      await notify({
        users: [t.assigneeUser],
        kind: "approval",
        tone: approve ? "positive" : "negative",
        title: approve ? `Task approved: ${t.title}` : `Task sent back: ${t.title}`,
        body: approve ? (note || undefined) : note,
        href: "/tasks",
        actor: actorId,
      });
    }
    // Sent back: the reason by email too, since they have to act on it.
    if (!approve) emailSentBack({ user: t.assigneeUser, employee: t.assignee }, t.title, note ?? "", byName, t.organization);
    return this.get(id, { userId: actorId, canView: true });
  }
}
