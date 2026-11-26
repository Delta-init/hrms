import { Types } from "mongoose";
import { DayPlan, DayPlanDay } from "../models/DayPlan.js";
import { Employee } from "../models/Employee.js";
import { Organization } from "../models/Organization.js";
import { scoped, getOrgId } from "../utils/orgContext.js";
import { LEFT_STATUSES } from "../utils/employeeStatus.js";
import { todayInTz } from "../utils/schedule.js";
import { weekdayOf } from "../utils/taskRepeat.js";
import { schedule, toHHMM, toMin } from "../utils/dayPlan.js";
import { notify } from "./notificationService.js";
import type { DayPlanInput, AddDayItemInput } from "../validations/dayPlanValidation.js";

/*
 * Day plans (2026-11-26). HR keeps a routine per person; each working day it is copied into that day's plan when
 * someone first opens it — him in the morning, or HR. He can tick areas and their checklist items, add tasks, move
 * them and change their length, for that day only. See models/DayPlan.ts and utils/dayPlan.ts.
 */

const fail = (message: string, statusCode: number) => Object.assign(new Error(message), { statusCode });

async function today() {
  const org = await Organization.findById(getOrgId()).select("settings.timeZone").lean<{ settings?: { timeZone?: string } } | null>();
  return todayInTz(org?.settings?.timeZone || "Asia/Dubai");
}

type DayDoc = InstanceType<typeof DayPlanDay>;

/** A day with its times worked out, and its rounds. */
function shapeDay(d: Record<string, unknown>) {
  const items = (d.items ?? []) as Array<Record<string, unknown> & { mins: number; fixedAt?: string | null; steps?: Array<{ done?: boolean }> }>;
  const slots = schedule(String(d.startAt), items);
  const dayEnd = slots.length ? slots[slots.length - 1].end : toMin(String(d.startAt));
  const every = Number(d.roundEveryMins ?? 0);
  const done = new Map(((d.rounds ?? []) as Array<{ due: string; doneAt: Date }>).map((r) => [r.due, r.doneAt]));
  const rounds: Array<{ due: string; doneAt: Date | null }> = [];
  if (every > 0) for (let t = toMin(String(d.startAt)) + every; t < dayEnd; t += every) rounds.push({ due: toHHMM(t), doneAt: done.get(toHHMM(t)) ?? null });
  const work = items.filter((i) => i.kind !== "break");
  return {
    ...d,
    items: items.map((it, i) => ({ ...it, start: toHHMM(slots[i].start), end: toHHMM(slots[i].end), free: slots[i].free, over: slots[i].over })),
    endsAt: toHHMM(dayEnd),
    rounds,
    progress: { done: work.filter((i) => i.done).length, total: work.length },
  };
}

/** The routine copied into one day, with each item's start as HR set it. */
async function makeDay(plan: InstanceType<typeof DayPlan>, date: string) {
  const items = plan.items.map((it) => it.toObject() as { title: string; mins: number; steps: string[]; fixedAt?: string | null; kind: string });
  const slots = schedule(plan.startAt, items);
  try {
    return await DayPlanDay.create({
      organization: plan.organization,
      plan: plan._id,
      employee: plan.employee,
      user: plan.user,
      date,
      startAt: plan.startAt,
      roundEveryMins: plan.roundEveryMins,
      items: items.map((it, i) => ({
        title: it.title, mins: it.mins, fixedAt: it.fixedAt ?? null, kind: it.kind,
        steps: (it.steps ?? []).map((title) => ({ title })),
        plannedAt: toHHMM(slots[i].start),
      })),
      history: [{ at: new Date(), action: "opened", note: "" }],
    });
  } catch (e) {
    // Opened at the same moment by him and HR: the other request made it.
    if ((e as { code?: number }).code === 11000) return DayPlanDay.findOne({ plan: plan._id, date });
    throw e;
  }
}

/** That day's plan, made from the routine if it's a working day and nobody has opened it yet. Past days aren't made. */
async function getOrMakeDay(plan: InstanceType<typeof DayPlan>, date: string, isToday: boolean) {
  const existing = await DayPlanDay.findOne({ plan: plan._id, date });
  if (existing) return existing;
  if (!isToday || !plan.active || !plan.weekdays.includes(weekdayOf(date))) return null;
  const here = await Employee.exists({ _id: plan.employee, status: { $nin: [...LEFT_STATUSES] } });
  if (!here) return null;
  return makeDay(plan, date);
}

// ── HR: routines ──────────────────────────────────────────────────────────────

export async function listPlans() {
  return DayPlan.find(scoped({})).populate({ path: "employee", select: "name employeeCode designation" }).sort({ active: -1, name: 1 }).lean();
}

export async function getPlan(id: string) {
  const p = await DayPlan.findOne(scoped({ _id: id })).populate({ path: "employee", select: "name employeeCode designation" }).lean();
  if (!p) throw fail("Day plan not found", 404);
  return p;
}

function checkItems(items: DayPlanInput["items"]) {
  const fixed = items.filter((i) => i.fixedAt).map((i) => toMin(i.fixedAt!));
  for (let i = 1; i < fixed.length; i++) if (fixed[i] <= fixed[i - 1]) throw fail("Fixed times must be in order through the day", 400);
}

export async function createPlan(input: DayPlanInput, actorId: string) {
  const emp = await Employee.findOne(scoped({ _id: input.employee, status: { $nin: [...LEFT_STATUSES] } })).select("user name").lean<{ user?: Types.ObjectId | null; name?: string } | null>();
  if (!emp) throw fail("That person wasn't found or has left", 400);
  checkItems(input.items);
  const plan = await DayPlan.create({ ...input, organization: getOrgId(), user: emp.user ?? null, createdBy: actorId });
  if (emp.user) {
    await notify({ users: [emp.user], kind: "reminder", title: `Your day plan: ${input.name}`, body: "Open Tasks to see your day by the clock", href: "/tasks", actor: actorId });
  }
  return getPlan(String(plan._id));
}

/** Changes the routine from the next day it's opened; a day already opened keeps what it was given. */
export async function updatePlan(id: string, input: Partial<DayPlanInput>) {
  const plan = await DayPlan.findOne(scoped({ _id: id }));
  if (!plan) throw fail("Day plan not found", 404);
  if (input.items) checkItems(input.items);
  if (input.employee && String(input.employee) !== String(plan.employee)) {
    const emp = await Employee.findOne(scoped({ _id: input.employee, status: { $nin: [...LEFT_STATUSES] } })).select("user").lean<{ user?: Types.ObjectId | null } | null>();
    if (!emp) throw fail("That person wasn't found or has left", 400);
    plan.user = (emp.user ?? null) as never;
  }
  const { items, ...rest } = input;
  Object.assign(plan, rest);
  if (items) plan.set("items", items);
  await plan.save();
  return getPlan(id);
}

/** HR's look at one day. Today is made if nobody has opened it yet; a past day nobody opened is null. */
export async function dayForPlan(id: string, date?: string) {
  const plan = await DayPlan.findOne(scoped({ _id: id }));
  if (!plan) throw fail("Day plan not found", 404);
  const t = await today();
  const d = await getOrMakeDay(plan, date ?? t, (date ?? t) === t);
  return { plan: { _id: plan._id, name: plan.name }, date: date ?? t, day: d ? shapeDay(d.toObject() as Record<string, unknown>) : null };
}

// ── His side ──────────────────────────────────────────────────────────────────

export async function myDays(userId: string) {
  const t = await today();
  const plans = await DayPlan.find(scoped({ user: new Types.ObjectId(userId), active: true }));
  const out = [];
  for (const p of plans) {
    const d = await getOrMakeDay(p, t, true);
    if (d) out.push({ ...shapeDay(d.toObject() as Record<string, unknown>), planName: p.name });
  }
  return out;
}

async function myDay(dayId: string, userId: string) {
  const d = await DayPlanDay.findOne(scoped({ _id: dayId }));
  if (!d || String(d.user) !== userId) throw fail("Day plan not found", 404);
  if (d.date !== (await today())) throw fail("That day is over, so it can't be changed", 400);
  return d;
}
const itemOf = (d: DayDoc, itemId: string) => {
  const it = d.items.find((i) => String(i._id) === itemId);
  if (!it) throw fail("Task not found on today's plan", 404);
  return it;
};
const done = async (d: DayDoc, action: string, note = "") => {
  d.history.push({ at: new Date(), action, note } as never);
  await d.save();
  return shapeDay(d.toObject() as Record<string, unknown>);
};

/** Tick an area: every checklist item with it. Unticking clears them too. */
export async function tickItem(dayId: string, itemId: string, isDone: boolean, userId: string) {
  const d = await myDay(dayId, userId);
  const it = itemOf(d, itemId);
  if (it.kind === "break") throw fail("A break can't be ticked", 400);
  const now = new Date();
  it.done = isDone;
  it.doneAt = isDone ? now : null;
  for (const s of it.steps) { if (isDone && !s.done) { s.done = true; s.doneAt = now; } if (!isDone) { s.done = false; s.doneAt = null; } }
  return done(d, isDone ? "done" : "undone", it.title);
}

/** Tick one checklist item. Ticking the last one finishes the area; unticking one reopens it. */
export async function tickStep(dayId: string, itemId: string, stepId: string, isDone: boolean, userId: string) {
  const d = await myDay(dayId, userId);
  const it = itemOf(d, itemId);
  const s = it.steps.find((x) => String(x._id) === stepId);
  if (!s) throw fail("Checklist item not found", 404);
  const now = new Date();
  s.done = isDone;
  s.doneAt = isDone ? now : null;
  if (it.steps.length && it.steps.every((x) => x.done)) { if (!it.done) { it.done = true; it.doneAt = now; } }
  else if (it.done) { it.done = false; it.doneAt = null; }
  return done(d, isDone ? "step_done" : "step_undone", `${it.title}: ${s.title}`);
}

export async function addItem(dayId: string, input: AddDayItemInput, userId: string) {
  const d = await myDay(dayId, userId);
  const at = input.afterId ? d.items.findIndex((i) => String(i._id) === input.afterId) + 1 : d.items.length;
  if (input.afterId && at === 0) throw fail("Task not found on today's plan", 404);
  d.items.splice(at, 0, { title: input.title, mins: input.mins, steps: (input.steps ?? []).map((title) => ({ title })), addedByHim: true, kind: "task" } as never);
  return done(d, "added", input.title);
}

/** New order of the same tasks. A fixed-time task can't move. */
export async function reorder(dayId: string, ids: string[], userId: string) {
  const d = await myDay(dayId, userId);
  const now = d.items.map((i) => String(i._id));
  if (ids.length !== now.length || new Set(ids).size !== ids.length || !ids.every((x) => now.includes(x))) throw fail("The list changed — reload and try again", 409);
  d.items.forEach((it, i) => { if (it.fixedAt && ids[i] !== String(it._id)) throw fail(`"${it.title}" has a fixed time and stays where it is`, 400); });
  const byId = new Map(d.items.map((i) => [String(i._id), i.toObject()]));
  d.set("items", ids.map((x) => byId.get(x)));
  return done(d, "reordered");
}

export async function setLength(dayId: string, itemId: string, mins: number, userId: string) {
  const d = await myDay(dayId, userId);
  const it = itemOf(d, itemId);
  if (it.fixedAt) throw fail("A fixed-time task keeps its length", 400);
  it.mins = mins;
  return done(d, "length", `${it.title}: ${mins} min`);
}

export async function removeItem(dayId: string, itemId: string, userId: string) {
  const d = await myDay(dayId, userId);
  const it = itemOf(d, itemId);
  if (!it.addedByHim) throw fail("Only tasks you added can be removed", 400);
  d.items.pull(it._id);
  return done(d, "removed", it.title);
}

export async function roundDone(dayId: string, due: string, userId: string) {
  const d = await myDay(dayId, userId);
  const shaped = shapeDay(d.toObject() as Record<string, unknown>);
  if (!shaped.rounds.some((r) => r.due === due)) throw fail("No round is due at that time", 400);
  if (!d.rounds.some((r) => r.due === due)) d.rounds.push({ due, doneAt: new Date() } as never);
  return done(d, "round", due);
}
