import { Types } from "mongoose";
import { Employee } from "../models/Employee.js";
import { CompanyDocument } from "../models/CompanyDocument.js";
import { VisaSubmission } from "../models/VisaSubmission.js";
import { DocumentReminderLog } from "../models/DocumentReminderLog.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { scoped, getOrgId } from "../utils/orgContext.js";
import { todayInTz } from "../utils/schedule.js";
import { RENEWAL_GRACE_DAYS } from "../utils/visaGate.js";
import { dueReminder, whenText, MILESTONES, type DueReminder } from "../utils/visaReminders.js";
import { expiringDocs } from "../utils/expiringDocs.js";
import { ignoredSlots } from "./documentOverviewService.js";
import { headContactsFor } from "./departmentHeadService.js";
import { notify } from "./notificationService.js";
import { sendMail } from "../utils/mailer.js";

/**
 * The daily document-expiry reminders, for every document that runs out:
 * visa, labour card, Emirates ID, passport, custom documents (health
 * insurance, ILOE…) and company documents. At 30, 15, 5, 2 and 1 days before,
 * on the day, and every day after until a renewed date is entered.
 *
 * The employee hears about their own documents. HR and each department head
 * get one notification and one email a day with everything due in it — one
 * summary, grouped, rather than one message per document. Company documents
 * go to HR only.
 *
 * The visa keeps its own rules: its status comes from what the employee sent
 * through the visa popup, and its daily after-expiry reminders pause while a
 * new visa is waiting for HR or a renewal is under way. A document HR has
 * muted on the Documents page is not reminded about at all.
 */

const TZ = "Asia/Dubai";
const CURRENT = ["active", "probation", "notice_period"];
const DAY_MS = 86_400_000;

const fmtDay = (key: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

type Latest = { kind: "visa" | "renewal"; status: "pending" | "approved" | "rejected"; submittedAt: Date } | null;

/** Where the visa stands, in words, and whether somebody is already dealing with it. */
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

type Group = "visa" | "employee" | "company";

interface Item {
  group: Group;
  /** The employee — absent for a company document. */
  employee: { id: string; userId: string; name: string; email: string; department: string } | null;
  /** "Visa", "Labour card", "Health insurance", "Trade licence — Delta LLC"… */
  label: string;
  expiryDay: string;
  due: DueReminder;
  status: string;
}

const whenPhrase = (due: DueReminder) =>
  due.stage === "after" ? `expired ${whenText(due.daysLeft)}` : due.stage === "day" ? "expires today" : `expires ${whenText(due.daysLeft)}`;

const GROUP_TITLE: Record<Group, string> = { visa: "Visas", employee: "Other employee documents", company: "Company documents" };

function digestHtml(items: Item[], intro: string) {
  const sections = (["visa", "employee", "company"] as Group[])
    .map((g) => {
      const list = items.filter((i) => i.group === g);
      if (!list.length) return "";
      const rows = list.map((i) => `<tr>
        <td style="padding:6px 10px;border-top:1px solid #eee"><strong>${esc(i.employee?.name ?? i.label)}</strong><br><span style="color:#666;font-size:12px">${esc(i.employee ? `${i.label}${i.employee.department ? ` · ${i.employee.department}` : ""}` : "Company")}</span></td>
        <td style="padding:6px 10px;border-top:1px solid #eee">${fmtDay(i.expiryDay)}<br><span style="color:${i.due.daysLeft < 0 ? "#b91c1c" : "#b45309"};font-size:12px">${whenPhrase(i.due)}</span></td>
        <td style="padding:6px 10px;border-top:1px solid #eee;font-size:13px">${esc(i.status)}</td>
      </tr>`).join("");
      return `<h3 style="font-size:14px;margin:18px 0 4px">${GROUP_TITLE[g]} (${list.length})</h3>
        <table style="border-collapse:collapse;width:100%;max-width:640px">
          <thead><tr style="text-align:left;color:#666;font-size:12px"><th style="padding:6px 10px">${g === "company" ? "Document" : "Employee"}</th><th style="padding:6px 10px">Expiry</th><th style="padding:6px 10px">Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    })
    .join("");
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111"><p>${esc(intro)}</p>${sections}
    <p style="color:#666;font-size:12px;margin-top:18px">Sent by Delta HRMS. Documents are under Documents; visas sent in by employees are under Documents › Visa updates.</p></div>`;
}

const digestText = (items: Item[]) =>
  items.map((i) => `${i.employee ? `${i.employee.name} — ${i.label}` : i.label}: ${whenPhrase(i.due)} (${fmtDay(i.expiryDay)}) — ${i.status}`).join("\n");

const summaryTitle = (n: number) => `${n} document${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} renewing`;
const summaryBody = (list: Item[]) =>
  list.slice(0, 3).map((i) => `${i.employee ? `${i.employee.name}'s ${i.label.toLowerCase()}` : i.label} ${whenPhrase(i.due)}`).join("; ") +
  (list.length > 3 ? `; and ${list.length - 3} more` : "");

/** HR for this: whoever may edit employees — the same people who approve visas. Not Super Admin. */
async function hrUsers(organization: Types.ObjectId) {
  const roles = await Role.find({ "permissions.employees.edit": true, $or: [{ organization }, { organization: null }] })
    .select("_id roleName isSystemRole")
    .lean();
  const ids = roles.filter((r) => !(r.isSystemRole && r.roleName === "Super Admin")).map((r) => r._id);
  if (!ids.length) return [];
  return User.find({ organization, role: { $in: ids }, status: "active" }).select("_id email name").lean();
}

/** Write the log entry first: if another run already did, this one sends nothing for it. */
async function claim(organization: Types.ObjectId, subject: Types.ObjectId, doc: string, expiryDay: string, key: string, now: Date) {
  try {
    await DocumentReminderLog.create({ organization, subject, doc, expiryDay, key, sentAt: now });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false;
    throw err;
  }
}

type StaffRow = {
  _id: Types.ObjectId; name?: string; location?: string | null; visaNotRequired?: boolean;
  user?: { _id: Types.ObjectId; email?: string; status?: string } | null;
  department?: { name?: string } | null;
  visa?: { expiryDate?: Date | null } | null; passport?: { expiryDate?: Date | null } | null;
  emiratesId?: { expiryDate?: Date | null } | null; labourCard?: { expiryDate?: Date | null } | null;
  otherDocuments?: { _id?: unknown; label?: string; expiryDate?: Date | null }[];
};

/**
 * Send whatever is due today in the organisation in scope. Each reminder is
 * logged before it is sent, so a second run the same day finds nothing to do.
 */
export async function runDocumentReminders(now = new Date()) {
  const orgId = getOrgId();
  if (!orgId) return { due: 0 };
  const organization = new Types.ObjectId(orgId);
  const today = todayInTz(TZ, now);
  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + (MILESTONES[0] + 1) * DAY_MS);
  const dated = { $ne: null, $lte: horizon };

  const [staff, companyDocs, muted] = await Promise.all([
    Employee.find(scoped({
      status: { $in: CURRENT }, user: { $ne: null },
      $or: [
        { "visa.expiryDate": dated }, { "passport.expiryDate": dated }, { "emiratesId.expiryDate": dated },
        { "labourCard.expiryDate": dated }, { "otherDocuments.expiryDate": dated },
      ],
    }))
      .select("name location visaNotRequired user department visa passport emiratesId labourCard otherDocuments")
      .populate("department", "name")
      .populate("user", "email status")
      .lean<StaffRow[]>(),
    CompanyDocument.find({ organization, expiryDate: dated }).select("companyName documentType number expiryDate").lean(),
    ignoredSlots(orgId),
  ]);

  const ids = staff.map((e) => e._id);
  const subjects = [...ids, ...companyDocs.map((d) => d._id)];
  const [latestRows, logs] = await Promise.all([
    ids.length
      ? VisaSubmission.aggregate<{ employee: Types.ObjectId; kind: "visa" | "renewal"; status: "pending" | "approved" | "rejected"; submittedAt: Date }>([
          { $match: { employee: { $in: ids } } },
          { $sort: { submittedAt: -1 } },
          { $group: { _id: "$employee", doc: { $first: "$$ROOT" } } },
          { $replaceRoot: { newRoot: "$doc" } },
        ])
      : Promise.resolve([]),
    subjects.length ? DocumentReminderLog.find({ subject: { $in: subjects } }).select("subject doc expiryDay key").lean() : Promise.resolve([]),
  ]);
  const latestBy = new Map(latestRows.map((l) => [String(l.employee), l]));
  const sentBy = new Map<string, Set<string>>();
  for (const l of logs) {
    const k = `${l.subject}|${l.doc}|${l.expiryDay}`;
    if (!sentBy.has(k)) sentBy.set(k, new Set());
    sentBy.get(k)!.add(l.key);
  }
  const sentFor = (subject: unknown, doc: string, expiryDay: string) => sentBy.get(`${subject}|${doc}|${expiryDay}`) ?? new Set<string>();

  const items: Item[] = [];
  for (const e of staff) {
    if (!e.user || e.user.status === "inactive") continue;
    const who = { id: String(e._id), userId: String(e.user._id), name: e.name ?? "An employee", email: e.user.email ?? "", department: e.department?.name ?? "" };
    for (const d of expiringDocs(e)) {
      if (muted.has(`${String(e._id)}:${d.slot}`)) continue;
      const visa = d.isVisa ? visaStatus(latestBy.get(String(e._id)) ?? null, d.expiryDay, now) : null;
      const due = dueReminder({ expiryDay: d.expiryDay, today, sent: sentFor(e._id, d.doc, d.expiryDay), paused: !!visa?.handled });
      if (!due || !(await claim(organization, e._id, d.doc, d.expiryDay, due.key, now))) continue;
      items.push({ group: d.isVisa ? "visa" : "employee", employee: who, label: d.label, expiryDay: d.expiryDay, due, status: visa?.text ?? "Not renewed yet" });
    }
  }
  for (const c of companyDocs) {
    const expiryDay = c.expiryDate ? new Date(Math.round(new Date(c.expiryDate).getTime() / DAY_MS) * DAY_MS).toISOString().slice(0, 10) : null;
    if (!expiryDay) continue;
    const due = dueReminder({ expiryDay, today, sent: sentFor(c._id, "company", expiryDay), paused: false });
    if (!due || !(await claim(organization, c._id as Types.ObjectId, "company", expiryDay, due.key, now))) continue;
    items.push({ group: "company", employee: null, label: `${c.documentType} — ${c.companyName}${c.number ? ` (${c.number})` : ""}`, expiryDay, due, status: "Not renewed yet" });
  }
  if (!items.length) return { due: 0 };

  // Each employee: one notification and one email about their own documents.
  const byEmployee = new Map<string, Item[]>();
  for (const i of items) if (i.employee) byEmployee.set(i.employee.id, [...(byEmployee.get(i.employee.id) ?? []), i]);
  for (const list of byEmployee.values()) {
    const who = list[0].employee!;
    const title = list.length === 1
      ? `Your ${list[0].label.toLowerCase()} ${whenPhrase(list[0].due)}`
      : `${list.length} of your documents need renewing`;
    const body = list.map((i) => `${i.label}: ${fmtDay(i.expiryDay)} (${whenPhrase(i.due)}) — ${i.status}`).join(" · ");
    await notify({ users: [who.userId], organization, kind: "reminder", tone: list.some((i) => i.due.daysLeft <= 2) ? "negative" : "neutral", title, body, href: "/profile" });
    if (who.email) {
      await sendMail({
        to: who.email, organization, subject: title,
        html: `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111"><p>Hello ${esc(who.name.split(" ")[0])},</p>
          <ul>${list.map((i) => `<li><strong>${esc(i.label)}</strong> — ${fmtDay(i.expiryDay)}, ${whenPhrase(i.due)}. ${esc(i.status)}.</li>`).join("")}</ul>
          <p>${list.some((i) => i.group === "visa") ? "Send your renewed visa in Delta HRMS — HR checks it before it counts. " : ""}${list.some((i) => i.group === "employee") ? "For the others, give the renewed document to HR so they can update your record." : ""}</p></div>`,
        text: list.map((i) => `${i.label} — ${fmtDay(i.expiryDay)}, ${whenPhrase(i.due)}. ${i.status}.`).join("\n"),
      }).catch(() => false);
    }
  }

  // HR: one notification and one email for the day, everything in it.
  const hr = await hrUsers(organization);
  if (hr.length) {
    await notify({ users: hr.map((u) => u._id), organization, kind: "reminder", title: summaryTitle(items.length), body: summaryBody(items), href: "/documents" });
    const to = hr.map((u) => u.email).filter((x): x is string => !!x);
    if (to.length) {
      await sendMail({ to, organization, subject: `Document expiry: ${summaryTitle(items.length)}`, html: digestHtml(items, "These documents are coming up for renewal or have expired:"), text: digestText(items) }).catch(() => false);
    }
  }

  // Each department head: the same, for their own people. Never company documents.
  const byHead = new Map<string, { email: string; list: Item[] }>();
  for (const i of items) {
    if (!i.employee) continue;
    for (const h of await headContactsFor(i.employee.userId)) {
      if (h.userId === i.employee.userId) continue;
      if (!byHead.has(h.userId)) byHead.set(h.userId, { email: h.email, list: [] });
      byHead.get(h.userId)!.list.push(i);
    }
  }
  for (const [headId, { email, list }] of byHead) {
    await notify({ users: [headId], organization, kind: "reminder", title: `${summaryTitle(list.length)} in your team`, body: summaryBody(list), href: "/dashboard" });
    if (email) {
      await sendMail({ to: email, organization, subject: `Document expiry in your team: ${summaryTitle(list.length)}`, html: digestHtml(list, "Documents in your team coming up for renewal or already expired:"), text: digestText(list) }).catch(() => false);
    }
  }

  return { due: items.length, hr: hr.length, heads: byHead.size };
}
