import { Types } from "mongoose";
import { Employee } from "../models/Employee.js";
import { VisaSubmission } from "../models/VisaSubmission.js";
import { VisaReminderLog } from "../models/VisaReminderLog.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { scoped, getOrgId } from "../utils/orgContext.js";
import { todayInTz } from "../utils/schedule.js";
import { dayOf, RENEWAL_GRACE_DAYS } from "../utils/visaGate.js";
import { dueReminder, whenText, MILESTONES, type DueReminder } from "../utils/visaReminders.js";
import { headContactsFor } from "./departmentHeadService.js";
import { notify } from "./notificationService.js";
import { sendMail } from "../utils/mailer.js";

/**
 * The daily visa reminders: to the employee, their department head and HR,
 * at 30, 15, 5, 2 and 1 days before the expiry, on the day, and every day
 * after until a new visa is approved.
 *
 * The employee hears about their own visa. HR and each head get one
 * notification and one email a day listing everyone due — twenty separate
 * emails about twenty visas is how reminders stop being read.
 */

const TZ = "Asia/Dubai";
const CURRENT = ["active", "probation", "notice_period"];
const DAY_MS = 86_400_000;

const fmtDay = (key: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

type Latest = { kind: "visa" | "renewal"; status: "pending" | "approved" | "rejected"; submittedAt: Date } | null;

/**
 * Where the visa stands, in words — the point of telling HR is that they can
 * see at a glance whether anybody is already dealing with it.
 */
export function visaStatus(latest: Latest, expiryDay: string, now: Date): { text: string; handled: boolean } {
  if (latest && latest.submittedAt.getTime() > Date.parse(`${expiryDay}T00:00:00Z`) - 400 * DAY_MS) {
    if (latest.status === "pending") {
      return { text: latest.kind === "visa" ? "New visa sent — waiting for HR approval" : "Renewal receipt sent — waiting for HR", handled: true };
    }
    if (latest.status === "approved" && latest.kind === "renewal") {
      const until = new Date(latest.submittedAt.getTime() + RENEWAL_GRACE_DAYS * DAY_MS);
      if (until > now) return { text: `Renewal in progress until ${fmtDay(until.toISOString().slice(0, 10))}`, handled: true };
    }
    if (latest.status === "rejected") return { text: "Sent back by HR — waiting for the employee", handled: false };
  }
  return { text: "No new visa sent yet", handled: false };
}

interface Item {
  employeeId: string;
  userId: string;
  name: string;
  email: string;
  department: string;
  expiryDay: string;
  due: DueReminder;
  status: string;
}

function headline(due: DueReminder, whose: string) {
  if (due.stage === "day") return `${whose} visa expires today`;
  if (due.stage === "after") return `${whose} visa expired ${whenText(due.daysLeft)}`;
  return `${whose} visa expires ${whenText(due.daysLeft)}`;
}

function digestHtml(items: Item[], intro: string) {
  const rows = items
    .map((i) => `<tr>
      <td style="padding:6px 10px;border-top:1px solid #eee"><strong>${esc(i.name)}</strong><br><span style="color:#666;font-size:12px">${esc(i.department || "—")}</span></td>
      <td style="padding:6px 10px;border-top:1px solid #eee">${fmtDay(i.expiryDay)}<br><span style="color:${i.due.daysLeft < 0 ? "#b91c1c" : "#b45309"};font-size:12px">${i.due.stage === "after" ? `expired ${whenText(i.due.daysLeft)}` : i.due.stage === "day" ? "expires today" : `expires ${whenText(i.due.daysLeft)}`}</span></td>
      <td style="padding:6px 10px;border-top:1px solid #eee;font-size:13px">${esc(i.status)}</td>
    </tr>`)
    .join("");
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111">
    <p>${esc(intro)}</p>
    <table style="border-collapse:collapse;width:100%;max-width:640px">
      <thead><tr style="text-align:left;color:#666;font-size:12px"><th style="padding:6px 10px">Employee</th><th style="padding:6px 10px">Visa expiry</th><th style="padding:6px 10px">Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="color:#666;font-size:12px">Sent by Delta HRMS. Visa updates are under Documents › Visa updates.</p>
  </div>`;
}

const digestText = (items: Item[]) =>
  items.map((i) => `${i.name} — ${i.due.stage === "after" ? `expired ${whenText(i.due.daysLeft)}` : `expires ${i.due.stage === "day" ? "today" : whenText(i.due.daysLeft)}`} (${fmtDay(i.expiryDay)}) — ${i.status}`).join("\n");

/** HR for this: whoever may edit employees — the same people who approve visas. Not Super Admin. */
async function hrUsers(organization: Types.ObjectId) {
  const roles = await Role.find({ "permissions.employees.edit": true, $or: [{ organization }, { organization: null }] })
    .select("_id roleName isSystemRole")
    .lean();
  const ids = roles.filter((r) => !(r.isSystemRole && r.roleName === "Super Admin")).map((r) => r._id);
  if (!ids.length) return [];
  return User.find({ organization, role: { $in: ids }, status: "active" }).select("_id email name").lean();
}

/**
 * Send whatever is due today in the organisation in scope. Each reminder is
 * logged before it is sent, so a second run the same day finds nothing to do.
 */
export async function runVisaReminders(now = new Date()) {
  const orgId = getOrgId();
  if (!orgId) return { due: 0 };
  const organization = new Types.ObjectId(orgId);
  const today = todayInTz(TZ, now);
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + (MILESTONES[0] + 1) * DAY_MS);

  const staff = await Employee.find(scoped({
    location: "dubai", status: { $in: CURRENT }, user: { $ne: null }, visaNotRequired: { $ne: true },
    "visa.expiryDate": { $ne: null, $lte: horizon },
  }))
    .select("name user visa department")
    .populate("department", "name")
    .populate("user", "email name status")
    .lean<{ _id: Types.ObjectId; name?: string; user?: { _id: Types.ObjectId; email?: string; status?: string } | null; visa?: { expiryDate?: Date | null }; department?: { name?: string } | null }[]>();
  if (!staff.length) return { due: 0 };

  const ids = staff.map((e) => e._id);
  const [latestRows, logs] = await Promise.all([
    VisaSubmission.aggregate<{ employee: Types.ObjectId; kind: "visa" | "renewal"; status: "pending" | "approved" | "rejected"; submittedAt: Date }>([
      { $match: { employee: { $in: ids } } },
      { $sort: { submittedAt: -1 } },
      { $group: { _id: "$employee", doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } },
    ]),
    VisaReminderLog.find({ employee: { $in: ids } }).select("employee expiryDay key").lean(),
  ]);
  const latestBy = new Map(latestRows.map((l) => [String(l.employee), l]));
  const sentBy = new Map<string, Set<string>>();
  for (const l of logs) {
    const k = `${l.employee}|${l.expiryDay}`;
    if (!sentBy.has(k)) sentBy.set(k, new Set());
    sentBy.get(k)!.add(l.key);
  }

  const items: Item[] = [];
  for (const e of staff) {
    if (!e.user || e.user.status === "inactive") continue;
    const expiryDay = dayOf(e.visa?.expiryDate ?? null);
    if (!expiryDay) continue;
    const latest = latestBy.get(String(e._id)) ?? null;
    const status = visaStatus(latest, expiryDay, now);
    const due = dueReminder({ expiryDay, today, sent: sentBy.get(`${e._id}|${expiryDay}`) ?? new Set(), paused: status.handled });
    if (!due) continue;
    try {
      await VisaReminderLog.create({ organization, employee: e._id, expiryDay, key: due.key, sentAt: now });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) continue; // another run got there first
      throw err;
    }
    items.push({
      employeeId: String(e._id), userId: String(e.user._id), name: e.name ?? "An employee", email: e.user.email ?? "",
      department: e.department?.name ?? "", expiryDay, due, status: status.text,
    });
  }
  if (!items.length) return { due: 0 };

  // The employee, about their own visa.
  for (const i of items) {
    const title = headline(i.due, "Your");
    const body = `Expiry: ${fmtDay(i.expiryDay)} · ${i.status}. ${i.due.daysLeft < 0 ? "Send your renewed visa in HRMS." : "Send the renewed visa in HRMS once you have it."}`;
    await notify({ users: [i.userId], organization, kind: "reminder", tone: i.due.daysLeft <= 2 ? "negative" : "neutral", title, body, href: "/profile" });
    if (i.email) {
      await sendMail({
        to: i.email, organization,
        subject: title,
        html: `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111"><p>Hello ${esc(i.name.split(" ")[0])},</p><p><strong>${esc(title)}</strong> — ${fmtDay(i.expiryDay)}.</p><p>Status: ${esc(i.status)}.</p><p>Open Delta HRMS and send a copy of your renewed visa with its new expiry date. HR checks it before it counts.</p></div>`,
        text: `${title} — ${fmtDay(i.expiryDay)}.\nStatus: ${i.status}.\nOpen Delta HRMS and send a copy of your renewed visa with its new expiry date.`,
      }).catch(() => false);
    }
  }

  // HR: one notification and one email for the day, everybody in it.
  const summaryTitle = (n: number) => `${n} visa${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} attention`;
  const summaryBody = (list: Item[]) => list.slice(0, 3).map((i) => `${i.name} — ${i.due.stage === "after" ? `expired ${whenText(i.due.daysLeft)}` : `expires ${i.due.stage === "day" ? "today" : whenText(i.due.daysLeft)}`}`).join("; ") + (list.length > 3 ? `; and ${list.length - 3} more` : "");
  const hr = await hrUsers(organization);
  if (hr.length) {
    await notify({ users: hr.map((u) => u._id), organization, kind: "reminder", title: summaryTitle(items.length), body: summaryBody(items), href: "/documents?tab=visa" });
    const to = hr.map((u) => u.email).filter((x): x is string => !!x);
    if (to.length) {
      await sendMail({ to, organization, subject: `Visa reminders: ${summaryTitle(items.length)}`, html: digestHtml(items, "These visas are coming up for renewal or have expired:"), text: digestText(items) }).catch(() => false);
    }
  }

  // Each department head: the same, for their own people.
  const byHead = new Map<string, { email: string; list: Item[] }>();
  for (const i of items) {
    for (const h of await headContactsFor(i.userId)) {
      if (h.userId === i.userId) continue;
      if (!byHead.has(h.userId)) byHead.set(h.userId, { email: h.email, list: [] });
      byHead.get(h.userId)!.list.push(i);
    }
  }
  for (const [headId, { email, list }] of byHead) {
    await notify({ users: [headId], organization, kind: "reminder", title: `${summaryTitle(list.length)} in your team`, body: summaryBody(list), href: "/dashboard" });
    if (email) {
      await sendMail({ to: email, organization, subject: `Visa reminders for your team: ${summaryTitle(list.length)}`, html: digestHtml(list, "Visas in your team coming up for renewal or already expired:"), text: digestText(list) }).catch(() => false);
    }
  }

  return { due: items.length, hr: hr.length, heads: byHead.size };
}
