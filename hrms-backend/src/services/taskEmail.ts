import { Types } from "mongoose";
import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import { Organization } from "../models/Organization.js";
import { TaskCategory } from "../models/Task.js";
import { sendMail } from "../utils/mailer.js";
import { env } from "../config/env.js";

/*
 * Task emails (2026-11-26): the person gets the task itself by email when it's given to them — a one-off task, a
 * repeating task being set up, a day plan — and when it's sent back for redo. Not for each day's copy of a repeating
 * task, nor for a cancellation.
 *
 * Sent after the record is saved and off the request's path: a slow or failing mail server never holds up or undoes
 * the task, it is only logged. Each organisation's own SMTP settings are used, as for every other HRMS email.
 */

export interface Recipient { user?: unknown; employee?: unknown }

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const PRIORITY: Record<string, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };

async function tzOf(organization: unknown) {
  const o = organization ? await Organization.findById(organization).select("settings.timeZone").lean<{ settings?: { timeZone?: string } } | null>() : null;
  return o?.settings?.timeZone || "Asia/Dubai";
}
const when = (d: Date, tz: string) => d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz });
const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const clock = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };

/** Each person's address: their login's email, else the one on their employee record. People without either are skipped. */
async function addresses(people: Recipient[]) {
  const userIds = people.map((p) => p.user).filter(Boolean).map(String);
  const empIds = people.map((p) => p.employee).filter(Boolean).map(String);
  const users = new Map((await User.find({ _id: { $in: userIds.map((x) => new Types.ObjectId(x)) } }).select("name email").lean()).map((u) => [String(u._id), u]));
  const emps = new Map((await Employee.find({ _id: { $in: empIds.map((x) => new Types.ObjectId(x)) } }).select("name email").lean()).map((e) => [String(e._id), e]));
  const out: Array<{ email: string; name: string }> = [];
  const seen = new Set<string>();
  for (const p of people) {
    const u = p.user ? users.get(String(p.user)) : undefined;
    const e = p.employee ? emps.get(String(p.employee)) : undefined;
    const email = String(u?.email || e?.email || "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, name: String(e?.name || u?.name || "") });
  }
  return out;
}

function layout(o: { heading: string; intro: string; facts: Array<[string, string]>; body?: string; button: string; note?: string }) {
  const facts = o.facts.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#888;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;color:#222">${v}</td></tr>`).join("");
  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#222">` +
    `<h2 style="color:#4f46e5;margin:0 0 6px">${esc(o.heading)}</h2>` +
    `<p style="color:#555;margin:0 0 14px">${o.intro}</p>` +
    (facts ? `<table style="border-collapse:collapse;font-size:14px;margin-bottom:14px">${facts}</table>` : "") +
    (o.body ?? "") +
    (o.note ? `<p style="color:#555;font-size:14px">${o.note}</p>` : "") +
    `<p style="margin-top:18px"><a href="${env.CLIENT_URL}/tasks" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">${esc(o.button)}</a></p>` +
    `<p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS.</p></div>`;
}

const stepsHtml = (steps: string[], title = "Steps") => steps.length
  ? `<p style="margin:0 0 4px;font-weight:600;font-size:14px">${esc(title)}</p><ol style="margin:0 0 12px;padding-left:20px;color:#333;font-size:14px">${steps.map((s) => `<li style="margin:2px 0">${esc(s)}</li>`).join("")}</ol>`
  : "";
const stepsText = (steps: string[]) => (steps.length ? `\nSteps:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}\n` : "");

/** Send one email per person, in the background. Never throws. */
function sendEach(people: Recipient[], organization: unknown, build: (name: string) => { subject: string; html: string; text: string }) {
  void (async () => {
    for (const r of await addresses(people)) {
      const m = build(r.name);
      await sendMail({ to: r.email, organization: organization ? String(organization) : null, ...m });
    }
  })().catch((e) => console.error("✉️  task email failed:", e instanceof Error ? e.message : e));
}

async function categoryName(id: unknown) {
  if (!id) return "";
  const c = await TaskCategory.findById(id).select("name").lean<{ name?: string } | null>();
  return String(c?.name ?? "");
}

interface TaskLike {
  title: string; details?: string; category?: unknown; priority?: string; steps: string[];
  needsApproval: boolean; proofRequired: boolean;
  /** How many files HR attached — named, not linked: file links expire within the hour. */
  attachments?: number;
}
const extras = (t: TaskLike) => [
  t.attachments ? `${t.attachments} file${t.attachments === 1 ? " is" : "s are"} attached to it in HRMS.` : "",
  t.needsApproval ? "When you mark it done, it goes to HR to approve." : "",
  t.proofRequired ? "Attach a photo or file as proof when you mark it done." : "",
].filter(Boolean).join(" ");

export async function emailTaskAssigned(people: Recipient[], t: TaskLike & { dueAt: Date }, byName: string, organization: unknown) {
  const [tz, cat] = await Promise.all([tzOf(organization), categoryName(t.category)]);
  const due = when(t.dueAt, tz);
  sendEach(people, organization, (name) => ({
    subject: `New task: ${t.title} (due ${due})`,
    html: layout({
      heading: t.title,
      intro: `Hi ${esc(name || "there")}, ${esc(byName || "HR")} has given you a task.`,
      facts: [["Due", esc(due)], ["Category", esc(cat)], ["Priority", t.priority && t.priority !== "normal" ? esc(PRIORITY[t.priority] ?? t.priority) : ""], ["Details", esc(t.details ?? "").replace(/\n/g, "<br>")]],
      body: stepsHtml(t.steps), note: esc(extras(t)), button: "Open my tasks",
    }),
    text: `Hi ${name || "there"},\n\n${byName || "HR"} has given you a task: ${t.title}\nDue: ${due}\n${cat ? `Category: ${cat}\n` : ""}${t.details ? `\n${t.details}\n` : ""}${stepsText(t.steps)}${extras(t) ? `\n${extras(t)}\n` : ""}\n${env.CLIENT_URL}/tasks\n`,
  }));
}

export async function emailSeriesCreated(people: Recipient[], t: TaskLike & { repeatText: string; dueTime: string; next: string[]; endsText: string }, byName: string, organization: unknown) {
  const cat = await categoryName(t.category);
  const next = t.next.map(day).join(", ");
  sendEach(people, organization, (name) => ({
    subject: `New repeating task: ${t.title} (${t.repeatText})`,
    html: layout({
      heading: t.title,
      intro: `Hi ${esc(name || "there")}, ${esc(byName || "HR")} has given you a repeating task. It appears in your tasks on each day it's due.`,
      facts: [["Repeats", `${esc(t.repeatText)}, due by ${esc(clock(t.dueTime))}`], ["Next", esc(next)], ["Ends", esc(t.endsText)], ["Category", esc(cat)], ["Priority", t.priority && t.priority !== "normal" ? esc(PRIORITY[t.priority] ?? t.priority) : ""], ["Details", esc(t.details ?? "").replace(/\n/g, "<br>")]],
      body: stepsHtml(t.steps), note: esc(extras(t)), button: "Open my tasks",
    }),
    text: `Hi ${name || "there"},\n\n${byName || "HR"} has given you a repeating task: ${t.title}\nRepeats: ${t.repeatText}, due by ${clock(t.dueTime)}\nNext: ${next}\nEnds: ${t.endsText}\n${t.details ? `\n${t.details}\n` : ""}${stepsText(t.steps)}${extras(t) ? `\n${extras(t)}\n` : ""}\n${env.CLIENT_URL}/tasks\n`,
  }));
}

export function emailDayPlanCreated(person: Recipient, p: { name: string; daysText: string; rounds: number; items: Array<{ start: string; title: string; mins: number; checks: number; kind: string }> }, byName: string, organization: unknown) {
  const rows = p.items.map((i) =>
    `<tr><td style="padding:5px 12px 5px 0;color:#4f46e5;font-weight:600;white-space:nowrap;vertical-align:top">${esc(clock(i.start))}</td>` +
    `<td style="padding:5px 0;color:${i.kind === "break" ? "#888" : "#222"}">${esc(i.title)}<span style="color:#888;font-size:12px"> · ${i.mins} min${i.checks ? ` · ${i.checks} checks` : ""}</span></td></tr>`).join("");
  sendEach([person], organization, (name) => ({
    subject: `Your day plan: ${p.name}`,
    html: layout({
      heading: p.name,
      intro: `Hi ${esc(name || "there")}, ${esc(byName || "HR")} has set up your day by the clock. Open Tasks each morning to tick off each area and its checks. You can add a task anywhere, or move one, and the rest of the day re-times itself.`,
      facts: [["Days", esc(p.daysText)], ["Rounds", p.rounds ? `Every ${p.rounds} minutes` : ""]],
      body: `<table style="border-collapse:collapse;font-size:14px;margin-bottom:10px">${rows}</table>`,
      button: "Open today's plan",
    }),
    text: `Hi ${name || "there"},\n\n${byName || "HR"} has set up your day plan: ${p.name}\nDays: ${p.daysText}\n\n${p.items.map((i) => `${clock(i.start).padStart(8)}  ${i.title} (${i.mins} min)`).join("\n")}\n\nOpen Tasks each morning to tick it off.\n${env.CLIENT_URL}/tasks\n`,
  }));
}

export function emailSentBack(person: Recipient, title: string, reason: string, byName: string, organization: unknown) {
  sendEach([person], organization, (name) => ({
    subject: `Task sent back: ${title}`,
    html: layout({
      heading: `Sent back: ${title}`,
      intro: `Hi ${esc(name || "there")}, ${esc(byName || "HR")} has sent this task back to be done again.`,
      facts: [["Reason", esc(reason).replace(/\n/g, "<br>")]],
      button: "Open the task",
    }),
    text: `Hi ${name || "there"},\n\n${byName || "HR"} has sent "${title}" back to be done again.\nReason: ${reason}\n\n${env.CLIENT_URL}/tasks\n`,
  }));
}
