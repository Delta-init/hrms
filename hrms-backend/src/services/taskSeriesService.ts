import { randomUUID } from "node:crypto";
import { Types } from "mongoose";
import { Task, TaskSeries, TaskCategory, TaskDigest } from "../models/Task.js";
import { Employee } from "../models/Employee.js";
import { Organization } from "../models/Organization.js";
import { scoped, getOrgId, runWithOrg } from "../utils/orgContext.js";
import { LEFT_STATUSES } from "../utils/employeeStatus.js";
import { todayInTz, zonedTimeToUtc } from "../utils/schedule.js";
import { datesToMake, upcoming, finished, describe, addDays, type RepeatRule } from "../utils/taskRepeat.js";
import { notify } from "./notificationService.js";
import { resolvePeople, nameOf, taskFail as fail } from "./taskService.js";
import type { CreateTaskInput, UpdateSeriesInput } from "../validations/taskValidation.js";

/*
 * Repeating tasks — Tasks Part 2 (the user, 2026-11-25). A series is the plan; each date it falls due, every
 * person in it gets their own copy, a normal Task with its own steps, approval and history. A missed date stays
 * missed and the next one still arrives.
 *
 *   make       today's copies are made when the series is created and then by the job, in the office's time zone;
 *              after a quiet spell it catches up at most a week, so a stalled server doesn't bury anyone
 *   edit       changes what is made from now on, plus today's copies nobody has touched yet
 *   pause      stops making copies; resuming starts from that day, without making the paused days late
 *   end        on its own after N times or on a date; or stopped by HR
 */

const CATCH_UP_DAYS = 7;

async function orgTimeZone() {
  const org = await Organization.findById(getOrgId()).select("settings.timeZone").lean<{ settings?: { timeZone?: string } } | null>();
  return org?.settings?.timeZone || "Asia/Dubai";
}

/** "HH:MM" of an instant, in a time zone. */
function clockIn(tz: string, d: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

type SeriesDoc = InstanceType<typeof TaskSeries>;
const ruleOf = (s: SeriesDoc | Record<string, unknown>): RepeatRule => {
  const x = s as unknown as { repeat: { kind: RepeatRule["kind"]; weekdays?: number[]; everyDays?: number | null }; startDate: string; ends: RepeatRule["ends"] };
  return { kind: x.repeat.kind, weekdays: x.repeat.weekdays ?? [], everyDays: x.repeat.everyDays ?? undefined, startDate: x.startDate, ends: x.ends };
};

export async function createSeries(input: CreateTaskInput, actorId: string) {
  const r = input.repeat!;
  const { people, viaDept } = await resolvePeople(input.employees, input.departments);
  const tz = await orgTimeZone();
  const startDate = todayInTz(tz, input.dueAt);
  if (r.ends.kind === "date" && r.ends.date && r.ends.date < startDate) throw fail("The last date is before the first one", 400);
  const byName = await nameOf(actorId);
  const series = await TaskSeries.create({
    organization: getOrgId(),
    title: input.title,
    details: input.details ?? "",
    category: input.category ?? null,
    priority: input.priority,
    steps: input.steps,
    needsApproval: input.needsApproval,
    proofRequired: input.proofRequired,
    assignees: [...people.values()].map((e) => ({ employee: e._id, user: e.user ?? null, viaDepartment: viaDept.get(String(e._id)) ?? null })),
    repeat: { kind: r.kind, weekdays: r.kind === "weekly" ? r.weekdays : [], everyDays: r.kind === "interval" ? r.everyDays : null },
    startDate,
    dueTime: clockIn(tz, input.dueAt),
    timeZone: tz,
    ends: { kind: r.ends.kind, count: r.ends.kind === "count" ? r.ends.count : null, date: r.ends.kind === "date" ? r.ends.date : null },
    createdBy: actorId,
    history: [{ at: new Date(), by: actorId, byName, action: "created", note: describe(r as never) }],
  });
  await notify({
    users: [...people.values()].map((e) => e.user).filter(Boolean),
    kind: "reminder",
    title: `New repeating task: ${input.title}`,
    body: `${describe(r as never)} · from ${byName || "HR"}`,
    href: "/tasks",
    actor: actorId,
  });
  const made = await makeDue(series, new Date());
  return { batch: null as string | null, created: made, series: String(series._id) };
}

/**
 * Make the copies a series owes, up to today in its time zone. Safe to run any number of times: the unique index
 * on (series, person, date) means a date is only ever made once per person.
 */
export async function makeDue(series: SeriesDoc, now = new Date()): Promise<number> {
  if (series.state !== "active") return 0;
  const tz = series.timeZone || "Asia/Dubai";
  const today = todayInTz(tz, now);
  const floor = addDays(today, -CATCH_UP_DAYS);
  const skip = series.skipBefore && series.skipBefore > floor ? series.skipBefore : floor;
  const after = [series.lastDate, addDays(skip, -1)].filter(Boolean).sort().at(-1) ?? null;
  const rule = ruleOf(series);
  const dates = datesToMake(rule, after, today, series.made ?? 0, CATCH_UP_DAYS + 1);
  if (!dates.length) {
    if (finished(rule, series.lastDate ?? null, series.made ?? 0) || (rule.ends.kind === "date" && rule.ends.date && today > rule.ends.date)) {
      series.state = "ended";
      await series.save();
    }
    return 0;
  }

  // People who have left get nothing more.
  const ids = series.assignees.map((a) => a.employee);
  const here = new Set((await Employee.find({ _id: { $in: ids }, status: { $nin: [...LEFT_STATUSES] } }).select("_id").lean()).map((e) => String(e._id)));
  const people = series.assignees.filter((a) => here.has(String(a.employee)));

  let made = 0;
  const createdNow = new Date();
  for (const date of dates) {
    const batch = randomUUID();
    const docs = people.map((a) => ({
      organization: series.organization,
      batch,
      series: series._id,
      occurrenceDate: date,
      title: series.title,
      details: series.details ?? "",
      category: series.category ?? null,
      priority: series.priority,
      assignee: a.employee,
      assigneeUser: a.user ?? null,
      viaDepartment: a.viaDepartment ?? null,
      assignedBy: series.createdBy,
      dueAt: zonedTimeToUtc(date, series.dueTime || "18:00", tz),
      steps: (series.steps ?? []).map((title) => ({ title })),
      needsApproval: series.needsApproval,
      proofRequired: series.proofRequired,
      history: [{ at: createdNow, by: null, byName: "", action: "assigned", note: `${describe(ruleOf(series))} · ${date}` }],
    }));
    if (docs.length) {
      try {
        const out = await Task.insertMany(docs, { ordered: false });
        made += out.length;
      } catch (e) {
        // Already made by an earlier run — the duplicates are refused, the rest go in.
        const inserted = (e as { insertedDocs?: unknown[]; result?: { insertedCount?: number } }).insertedDocs?.length
          ?? (e as { result?: { insertedCount?: number } }).result?.insertedCount ?? 0;
        if ((e as { code?: number; writeErrors?: Array<{ code?: number }> }).writeErrors?.some((w) => w.code !== 11000)) throw e;
        made += inserted;
      }
    }
    series.made = (series.made ?? 0) + 1;
    series.lastDate = date;
  }
  if (finished(rule, series.lastDate ?? null, series.made ?? 0)) series.state = "ended";
  await series.save();
  // No notice per copy: the 8 am morning list tells each person what's due today, once.
  return made;
}

// ── HR's side ───────────────────────────────────────────────────────────────

function shapeSeries(s: Record<string, unknown>, counts: { open: number; done: number; total: number }) {
  const rule = ruleOf(s);
  const tz = String(s.timeZone || "Asia/Dubai");
  const today = todayInTz(tz);
  const from = [today, s.lastDate ? addDays(String(s.lastDate), 1) : null].filter(Boolean).sort().at(-1)!;
  return {
    ...s,
    repeatText: describe(rule),
    next: s.state === "active" ? upcoming(rule, from, Number(s.made ?? 0), 3) : [],
    copies: counts,
  };
}

export async function listSeries(state?: string) {
  const filter = scoped(state ? { state } : { state: { $in: ["active", "paused"] } });
  const rows = await TaskSeries.find(filter)
    .populate([{ path: "category", select: "name color" }, { path: "createdBy", select: "name" }, { path: "assignees.employee", select: "name" }])
    .sort({ createdAt: -1 }).select("-history").lean();
  const stats = await Task.aggregate([
    { $match: { series: { $in: rows.map((r) => r._id) } } },
    { $group: { _id: "$series", total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } }, open: { $sum: { $cond: [{ $in: ["$status", ["todo", "in_progress", "submitted"]] }, 1, 0] } } } },
  ]);
  const by = new Map(stats.map((x) => [String(x._id), x]));
  return rows.map((r) => shapeSeries(r as Record<string, unknown>, by.get(String(r._id)) ?? { open: 0, done: 0, total: 0 }));
}

export async function getSeries(id: string) {
  const s = await TaskSeries.findOne(scoped({ _id: id }))
    .populate([{ path: "category", select: "name color" }, { path: "createdBy", select: "name" }, { path: "assignees.employee", select: "name employeeCode" }])
    .lean();
  if (!s) throw fail("Repeating task not found", 404);
  const [x] = await Task.aggregate([
    { $match: { series: s._id } },
    { $group: { _id: null, total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ["$status", "done"] }, 1, 0] } }, open: { $sum: { $cond: [{ $in: ["$status", ["todo", "in_progress", "submitted"]] }, 1, 0] } } } },
  ]);
  return shapeSeries(s as Record<string, unknown>, x ?? { open: 0, done: 0, total: 0 });
}

export async function updateSeries(id: string, input: UpdateSeriesInput, actorId: string) {
  const s = await TaskSeries.findOne(scoped({ _id: id }));
  if (!s) throw fail("Repeating task not found", 404);
  if (s.state === "ended") throw fail("It has ended — start a new one instead", 400);
  if (input.category && !(await TaskCategory.exists(scoped({ _id: input.category })))) throw fail("Category not found", 404);
  const { repeat, ...rest } = input;
  if (repeat) {
    if (repeat.kind === "once") throw fail("To stop it repeating, stop it instead", 400);
    if (repeat.ends.kind === "date" && repeat.ends.date && repeat.ends.date < (s.lastDate ?? s.startDate)) throw fail("The last date is before dates already made", 400);
    if (repeat.ends.kind === "count" && (repeat.ends.count ?? 0) < (s.made ?? 0)) throw fail(`It has already made ${s.made}; the count can't be lower`, 400);
    s.set("repeat", { kind: repeat.kind, weekdays: repeat.kind === "weekly" ? repeat.weekdays : [], everyDays: repeat.kind === "interval" ? repeat.everyDays : null });
    s.set("ends", { kind: repeat.ends.kind, count: repeat.ends.kind === "count" ? repeat.ends.count : null, date: repeat.ends.kind === "date" ? repeat.ends.date : null });
  }
  Object.assign(s, rest);
  s.history.push({ at: new Date(), by: actorId, byName: await nameOf(actorId), action: "edited", note: "" } as never);
  await s.save();

  // Today's copies nobody has started follow the change; anything begun keeps what it was given.
  const today = todayInTz(s.timeZone || "Asia/Dubai");
  const untouched = await Task.find({ series: s._id, occurrenceDate: today, status: "todo" });
  for (const t of untouched) {
    if (t.steps.some((x) => x.done)) continue;
    t.title = s.title; t.details = s.details ?? ""; t.category = s.category ?? null; t.priority = s.priority;
    t.needsApproval = s.needsApproval; t.proofRequired = s.proofRequired;
    t.set("steps", (s.steps ?? []).map((title) => ({ title })));
    t.dueAt = zonedTimeToUtc(today, s.dueTime || "18:00", s.timeZone || "Asia/Dubai");
    await t.save();
  }
  await makeDue(s);
  return getSeries(id);
}

export async function setSeriesState(id: string, state: "active" | "paused" | "ended", actorId: string) {
  const s = await TaskSeries.findOne(scoped({ _id: id }));
  if (!s) throw fail("Repeating task not found", 404);
  if (s.state === "ended") throw fail("It has already ended", 400);
  if (s.state === state) return getSeries(id);
  const today = todayInTz(s.timeZone || "Asia/Dubai");
  if (state === "active") s.skipBefore = today; // resume from today; the paused days aren't made late
  s.state = state;
  s.history.push({ at: new Date(), by: actorId, byName: await nameOf(actorId), action: state === "active" ? "resumed" : state === "paused" ? "paused" : "stopped", note: "" } as never);
  await s.save();
  if (state === "active") await makeDue(s);
  return getSeries(id);
}

// ── The job ─────────────────────────────────────────────────────────────────

const MORNING = "08:00";

function inOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => runWithOrg({ orgId, isSuperAdmin: false }, () => { fn().then(resolve, reject); }));
}

/** Once a day per organisation and kind: true for the first caller only, even across restarts. */
async function firstTime(organization: unknown, day: string, kind: string) {
  try { await TaskDigest.create({ organization, day, kind }); return true; }
  catch (e) { if ((e as { code?: number }).code === 11000) return false; throw e; }
}

/**
 * Every few minutes: make today's copies of every active series, tell people once when a task goes overdue, and
 * — once a morning, office time — tell each person what's due today.
 */
export async function runTaskJob(now = new Date()) {
  const orgs = await Organization.find({ status: "active" }).select("_id settings.timeZone").lean<Array<{ _id: Types.ObjectId; settings?: { timeZone?: string } }>>();
  let made = 0, overdue = 0, morning = 0;
  for (const org of orgs) {
    const orgId = String(org._id);
    await inOrg(orgId, async () => {
      for (const s of await TaskSeries.find({ organization: org._id, state: "active" })) {
        try { made += await makeDue(s, now); } catch (e) { console.error(`📋 series ${s._id} failed:`, e); }
      }

      // Overdue, told once. Only recent ones, so the first run after deploy doesn't dig up old work.
      const late = await Task.find({
        organization: org._id, status: { $in: ["todo", "in_progress"] }, overdueNotifiedAt: null,
        dueAt: { $lt: now, $gt: new Date(now.getTime() - 3 * 86_400_000) },
      }).select("title assigneeUser assignedBy dueAt").lean();
      for (const t of late) {
        await notify({
          users: [t.assigneeUser, t.assignedBy].filter(Boolean),
          kind: "reminder", tone: "negative",
          title: `Overdue: ${t.title}`,
          body: `Was due ${new Date(t.dueAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: org.settings?.timeZone || "Asia/Dubai" })}`,
          href: "/tasks",
          organization: org._id,
        });
        await Task.updateOne({ _id: t._id }, { $set: { overdueNotifiedAt: now } });
        overdue++;
      }

      // The morning list.
      const tz = org.settings?.timeZone || "Asia/Dubai";
      const today = todayInTz(tz, now);
      if (clockIn(tz, now) >= MORNING && (await firstTime(org._id, today, "morning"))) {
        const start = zonedTimeToUtc(today, "00:00", tz);
        const end = new Date(start.getTime() + 86_400_000);
        const rows = await Task.aggregate([
          { $match: { organization: org._id, status: { $in: ["todo", "in_progress"] }, dueAt: { $gte: start, $lt: end }, assigneeUser: { $ne: null } } },
          { $group: { _id: "$assigneeUser", n: { $sum: 1 }, first: { $first: "$title" } } },
        ]);
        for (const r of rows) {
          await notify({
            users: [r._id], kind: "reminder",
            title: r.n === 1 ? `Today: ${r.first}` : `You have ${r.n} tasks today`,
            body: r.n === 1 ? "Due today" : `Starting with ${r.first}`,
            href: "/tasks", organization: org._id,
          });
          morning++;
        }
      }
    });
  }
  if (made || overdue || morning) console.log(`📋 tasks: ${made} made, ${overdue} overdue notice(s), ${morning} morning notice(s).`);
  return { made, overdue, morning };
}
