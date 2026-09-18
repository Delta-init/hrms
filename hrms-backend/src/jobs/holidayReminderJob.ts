import cron from "node-cron";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { Organization } from "../models/Organization.js";
import { Holiday } from "../models/Holiday.js";
import { env } from "../config/env.js";
import { sendMail } from "../utils/mailer.js";
import { holidayScope } from "../utils/holidayScope.js";

/**
 * Told the evening before, not the morning of.
 *
 * Finding out a day is a holiday only once it has already started is no
 * warning at all — anything that needed arranging around it (a delivery, an
 * appointment, telling a client) had to happen the day before. So this looks
 * one day ahead and writes to whoever that day is actually a holiday for,
 * which is not everybody: a Kerala holiday is an ordinary Tuesday in Dubai,
 * and now that a holiday can belong to one work schedule specifically (see
 * holidayScope), it may not even be every remote worker's.
 */

interface Candidate {
  userId: unknown;
  name: string;
  email: string;
  workMode: "office" | "wfh" | null;
  scheduleId: unknown;
}

/** Everybody in one organisation who has a login to write to. */
async function candidatesFor(orgId: unknown): Promise<Candidate[]> {
  const employees = await Employee.find({ organization: orgId, status: { $ne: "terminated" }, user: { $ne: null } })
    .select("name user workMode")
    .lean();
  if (!employees.length) return [];

  const users = await User.find({ _id: { $in: employees.map((e) => e.user) }, status: { $ne: "inactive" } })
    .select("email workSchedule")
    .lean();
  const byUser = new Map(users.map((u) => [String(u._id), u]));

  const out: Candidate[] = [];
  for (const e of employees) {
    const u = byUser.get(String(e.user));
    if (!u?.email) continue;
    out.push({
      userId: e.user,
      name: String(e.name ?? "there"),
      email: u.email,
      workMode: (e as { workMode?: "office" | "wfh" }).workMode ?? null,
      scheduleId: u.workSchedule ?? null,
    });
  }
  return out;
}

/** The names of whatever holiday(s) fall on `dayStart` for this calendar. */
async function holidaysOn(
  orgId: unknown,
  dayStart: Date,
  workMode: "office" | "wfh" | null,
  scheduleId: unknown
): Promise<string[]> {
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const rows = await Holiday.find({
    organization: orgId,
    date: { $gte: dayStart, $lt: dayEnd },
    ...(await holidayScope(workMode, scheduleId)),
  })
    .select("name")
    .lean();
  return rows.map((h) => h.name);
}

function buildMail(name: string, dateLabel: string, names: string[]) {
  const list = names.join(" & ");
  const subject = `${dateLabel} is a holiday — ${list}`;
  const html =
    `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">` +
    `<h2 style="color:#4f46e5;margin-bottom:4px">🎉 Tomorrow is a holiday</h2>` +
    `<p style="color:#555">Hi ${name}, ${dateLabel} is <strong>${list}</strong> — no work expected on your calendar that day.</p>` +
    `<p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS.</p>` +
    `</div>`;
  const text = `Hi ${name},\n\n${dateLabel} is ${list} — no work expected on your calendar that day.\n`;
  return { subject, html, text };
}

/** Find tomorrow's holidays and email whoever they actually apply to. */
export async function runHolidayReminders(now = new Date()) {
  const orgs = await Organization.find({ status: "active" }).select("_id name").lean();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const dateLabel = tomorrow.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  let checked = 0;
  let sent = 0;

  for (const org of orgs) {
    const candidates = await candidatesFor(org._id);
    // One holiday lookup per distinct (workMode, scheduleId) pair rather than
    // per person — an office of eighty people asks this the same handful of
    // ways, not eighty different ones.
    const cache = new Map<string, string[]>();
    for (const c of candidates) {
      checked++;
      const cacheKey = `${c.workMode ?? ""}|${c.scheduleId ?? ""}`;
      let names = cache.get(cacheKey);
      if (names === undefined) {
        names = await holidaysOn(org._id, tomorrow, c.workMode, c.scheduleId);
        cache.set(cacheKey, names);
      }
      if (!names.length) continue;

      const { subject, html, text } = buildMail(c.name, dateLabel, names);
      const ok = await sendMail({ to: c.email, organization: String(org._id), subject, html, text });
      if (ok) sent++;
    }
  }

  if (!sent) console.log("🎉 holiday reminders: nothing to tell anyone tomorrow.");
  else console.log(`🎉 holiday reminders: ${checked} checked, ${sent} emailed.`);
  return { checked, emailed: sent };
}

/** Schedule the evening-before holiday reminder (server local time). */
export function startHolidayReminderCron() {
  const expr = env.HOLIDAY_REMINDER_CRON;
  if (!cron.validate(expr)) {
    console.error(`🎉 invalid HOLIDAY_REMINDER_CRON "${expr}" — holiday reminders disabled.`);
    return;
  }
  cron.schedule(expr, () => {
    runHolidayReminders().catch((e) => console.error("🎉 holiday reminder job failed:", e));
  });
  console.log(`🎉 holiday reminder cron scheduled: "${expr}"`);
}
