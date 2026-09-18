import cron from "node-cron";
import { cronSetting } from "../utils/cronSetting.js";
import { env } from "../config/env.js";
import { Confirmation } from "../models/Confirmation.js";
import { Employee } from "../models/Employee.js";
import { Organization } from "../models/Organization.js";
import { User } from "../models/User.js";
import { sendMail } from "../utils/mailer.js";
import { notify } from "../services/notificationService.js";
import { watchersFor } from "../services/watchers.js";
import { chainOfCommandFor } from "../services/departmentHeadService.js";
import { runWithOrg } from "../utils/orgContext.js";

/**
 * Probation, watched so nobody has to remember it.
 *
 * A probation period ends on a date nothing was checking. The confirmation
 * machinery already existed — a Confirmation record, an approval, and an
 * employee who becomes "active" once it is approved — but every part of it
 * had to be started by hand, so somebody had to notice the date first. Two
 * people here are more than three months past theirs.
 *
 * This raises the paperwork; it deliberately does not decide it. A day passing
 * is not evidence that somebody passed probation, and a job that quietly moved
 * people to "active" would be making a judgement nobody asked it to make. So
 * the record is created as "pending" and waits for HR, exactly as it would had
 * they started it themselves.
 */

/**
 * Three months, where nobody has said otherwise.
 *
 * `probationPeriodDays` is per-employee and the right answer when it is set,
 * but it defaults to 0 and almost nobody has filled it in — so a job that only
 * trusted that field would watch nobody at all.
 */
const DEFAULT_PROBATION_DAYS = 90;

const addDays = (d: Date, days: number) => {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
};
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

interface Candidate {
  _id: unknown;
  name?: string;
  employeeCode?: string;
  joiningDate?: Date | null;
  probationPeriodDays?: number;
  user?: unknown;
  probationReminderSentAt?: Date | null;
}

/** The day probation is up, from the joining date and the agreed length. */
function probationEndOf(emp: Candidate): Date | null {
  if (!emp.joiningDate) return null;
  return addDays(new Date(emp.joiningDate), emp.probationPeriodDays || DEFAULT_PROBATION_DAYS);
}

function withOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    runWithOrg({ orgId: String(orgId), isSuperAdmin: false }, () => {
      fn().then(resolve, reject);
    });
  });
}

const shell = (title: string, body: string, cta: string, link: string) =>
  `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">` +
  `<h2 style="color:#4f46e5;margin-bottom:4px">${title}</h2>` +
  `<p style="color:#555">${body}</p>` +
  `<p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">${cta}</a></p>` +
  `<p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS.</p></div>`;

const niceDate = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(d);

/**
 * HR, by who may actually approve a confirmation.
 *
 * Read from the permission rather than a role name: the role is called
 * different things in different organisations, and a lookup pinned to one
 * spelling fails silently — which for a notification is the worst way to fail.
 */
async function hrContacts(orgId: string): Promise<Array<{ id: string; email: string; name: string }>> {
  const ids = await withOrg(orgId, () => watchersFor("confirmations"));
  if (!ids.length) return [];
  const users = await User.find({ _id: { $in: ids }, status: { $ne: "inactive" } })
    .select("name email")
    .lean<Array<{ _id: unknown; name?: string; email?: string }>>();
  return users
    .filter((u) => !!u.email)
    .map((u) => ({ id: String(u._id), email: String(u.email), name: String(u.name ?? "there") }));
}

/** Raise the confirmation paperwork for anyone whose probation is up. */
async function raiseDue(orgId: string, emp: Candidate, end: Date): Promise<boolean> {
  const open = await Confirmation.findOne({ organization: orgId, employee: emp._id, status: "pending" })
    .select("_id")
    .lean();
  if (open) return false;

  await Confirmation.create({
    organization: orgId,
    employee: emp._id,
    dueDate: end,
    // Effective on the day probation actually ended, not the day this ran —
    // otherwise somebody confirmed three months late looks like they were on
    // probation until the morning a job happened to notice.
    confirmationDate: end,
    status: "pending",
    initiatedBy: null,
    notes: "Raised automatically — probation period complete.",
  });

  const hr = await hrContacts(orgId);
  const link = `${env.CLIENT_URL}/confirmations`;
  const who = `${emp.name ?? "An employee"}${emp.employeeCode ? ` (${emp.employeeCode})` : ""}`;
  for (const person of hr) {
    try {
      await sendMail({
        to: person.email,
        organization: orgId,
        subject: `${emp.name ?? "An employee"} is due for confirmation`,
        text:
          `${who} finished probation on ${niceDate(end)}.\n\n` +
          `A confirmation has been raised and is waiting for your decision: ${link}\n\n` +
          `Nothing has changed on their record — they stay on probation until this is approved.\n`,
        html: shell(
          "Due for confirmation",
          `<strong>${who}</strong> finished probation on <strong>${niceDate(end)}</strong>. ` +
            `A confirmation has been raised and is waiting for a decision. ` +
            `Nothing on their record has changed — they remain on probation until it is approved.`,
          "Review it",
          link
        ),
      });
    } catch {
      /* the record is saved; one failed notice must not cost the others */
    }
  }

  if (hr.length) {
    await withOrg(orgId, () =>
      notify({
        users: hr.map((p) => p.id),
        kind: "approval",
        title: `${emp.name ?? "Someone"} is due for confirmation`,
        body: `Probation ended ${niceDate(end)}`,
        href: "/confirmations",
      })
    );
  }
  return true;
}

/** Warn the day before, to whoever the decision touches. */
async function remindDayBefore(orgId: string, emp: Candidate, end: Date): Promise<boolean> {
  const link = `${env.CLIENT_URL}/confirmations`;
  const who = `${emp.name ?? "An employee"}${emp.employeeCode ? ` (${emp.employeeCode})` : ""}`;

  const recipients = new Map<string, { email: string; name: string; self: boolean }>();
  for (const person of await hrContacts(orgId)) {
    recipients.set(person.email, { email: person.email, name: person.name, self: false });
  }
  if (emp.user) {
    // Their line: the department head — co-leads included — and their manager.
    for (const c of await withOrg(orgId, () => chainOfCommandFor(String(emp.user)))) {
      if (!recipients.has(c.email)) recipients.set(c.email, { email: c.email, name: c.name, self: false });
    }
    const self = await User.findById(emp.user).select("name email status").lean<{ name?: string; email?: string; status?: string } | null>();
    if (self?.email && self.status !== "inactive") {
      recipients.set(self.email, { email: self.email, name: String(self.name ?? "there"), self: true });
    }
  }
  if (!recipients.size) return false;

  for (const person of recipients.values()) {
    // The person on probation is being told about their own date; everybody
    // else is being told there is something to decide. Same date, different
    // sentence — and telling somebody to "review" their own probation reads
    // as though the outcome were theirs to settle.
    const subject = person.self
      ? `Your probation period ends on ${niceDate(end)}`
      : `${emp.name ?? "An employee"}'s probation ends tomorrow`;
    const body = person.self
      ? `Hi ${person.name}, your probation period ends on <strong>${niceDate(end)}</strong>. ` +
        `HR will confirm your record from that date — there is nothing you need to do.`
      : `<strong>${who}</strong> finishes probation on <strong>${niceDate(end)}</strong>. ` +
        `The confirmation will be raised for approval once the date passes.`;
    try {
      await sendMail({
        to: person.email,
        organization: orgId,
        subject,
        text: body.replace(/<[^>]+>/g, "") + (person.self ? "\n" : `\n\n${link}\n`),
        html: person.self
          ? `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">` +
            `<h2 style="color:#4f46e5;margin-bottom:4px">Probation ending</h2><p style="color:#555">${body}</p>` +
            `<p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS.</p></div>`
          : shell("Probation ends tomorrow", body, "Open confirmations", link),
      });
    } catch {
      /* best effort per recipient */
    }
  }

  await Employee.updateOne({ _id: emp._id }, { $set: { probationReminderSentAt: new Date() } });
  return true;
}

/** One organisation's probations. Separate so it can be run against one org. */
export async function runProbationForOrg(orgId: string, now = new Date()) {
  let raised = 0;
  let reminded = 0;
  const today = dayKey(now);
  const tomorrow = dayKey(addDays(now, 1));

  // Only people actually on probation. Defaulting the period to ninety days
  // across everybody would otherwise sweep in every confirmed employee whose
  // `probationPeriodDays` was never filled in — which is almost all of them.
  const candidates = await Employee.find({
    organization: orgId,
    status: "probation",
    joiningDate: { $ne: null },
    $or: [{ confirmationDate: null }, { confirmationDate: { $exists: false } }],
  })
    .select("name employeeCode joiningDate probationPeriodDays user probationReminderSentAt")
    .lean<Candidate[]>();

  for (const emp of candidates) {
    const end = probationEndOf(emp);
    if (!end) continue;
    const key = dayKey(end);

    if (key <= today) {
      if (await raiseDue(orgId, emp, end)) raised++;
    } else if (key === tomorrow && !emp.probationReminderSentAt) {
      if (await remindDayBefore(orgId, emp, end)) reminded++;
    }
  }
  return { raised, reminded };
}

export async function runProbationChecks(now = new Date()) {
  const orgs = await Organization.find({ status: "active" }).select("_id").lean();
  let raised = 0;
  let reminded = 0;

  for (const org of orgs) {
    const result = await runProbationForOrg(String(org._id), now);
    raised += result.raised;
    reminded += result.reminded;
  }

  if (raised || reminded) {
    console.log(`🎓 probation: ${raised} confirmation(s) raised, ${reminded} reminder(s) sent.`);
  }
  return { raised, reminded };
}

export function startProbationCron() {
  const expr = cronSetting("PROBATION_CRON", env.PROBATION_CRON);
  if (!expr) return;
  cron.schedule(expr, () => {
    runProbationChecks().catch((e) => console.error("🎓 probation job failed:", e));
  });
  console.log(`🎓 probation cron scheduled: "${expr}"`);
}
