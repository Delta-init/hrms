import cron from "node-cron";
import { cronSetting } from "../utils/cronSetting.js";
import { Employee } from "../models/Employee.js";
import { Organization } from "../models/Organization.js";
import { User } from "../models/User.js";
import { env } from "../config/env.js";
import { sendMail } from "../utils/mailer.js";
import { AttendanceService } from "../services/attendanceService.js";
import { DEFAULT_SCHEDULE, resolveShift, todayInTz, type ShiftSchedule } from "../utils/schedule.js";

/**
 * This month's days worth a second look — a half day, one never marked at
 * all, a late arrival, an early finish — put in front of the person whose
 * days they are, before the month closes without them noticing.
 *
 * Reads the same calendar the "My Attendance" page already shows, so a day
 * flagged here is never a surprise when it is opened there. A day already
 * covered by a pending or approved correction is left out — this is a
 * reminder to raise one, not a second copy of the queue.
 *
 * It goes to the person alone, the same reasoning as the punch reminder
 * beside it: a list of who has gaps in their month is a manager's business
 * only once it is old enough to matter, and this is neither that list nor
 * that moment.
 */

export type Kind = "not_marked" | "half_day" | "late" | "early_out";

export interface FlaggedDay {
  /** YYYY-MM-DD, local to the employee's own shift. */
  date: string;
  kind: Kind;
  checkIn: string | null;
  checkOut: string | null;
}

export const LABEL: Record<Kind, string> = {
  not_marked: "Not marked",
  half_day: "Half day",
  late: "Late",
  early_out: "Left early",
};

const ORDER: Kind[] = ["not_marked", "half_day", "late", "early_out"];

const attendance = new AttendanceService();

function shiftFor(ws: { timeZone?: string; loginTime?: string; logoutTime?: string; graceMinutes?: number } | null): ShiftSchedule {
  if (!ws?.timeZone) return DEFAULT_SCHEDULE;
  return {
    timeZone: ws.timeZone,
    loginTime: ws.loginTime ?? DEFAULT_SCHEDULE.loginTime,
    logoutTime: ws.logoutTime ?? DEFAULT_SCHEDULE.logoutTime,
    graceMinutes: ws.graceMinutes ?? 15,
  };
}

/**
 * Exported so a popup can ask for exactly the list the weekend mail would
 * send, and so both can be checked against real data without mailing anyone.
 */
export async function flaggedDaysThisMonth(userId: string, orgId: unknown, now = new Date()): Promise<FlaggedDay[]> {
  const employee = await Employee.findOne({ organization: orgId, user: userId }).select("_id").lean();
  if (!employee) return [];

  const user = await User.findById(userId)
    .select("workSchedule")
    .populate("workSchedule", "timeZone loginTime logoutTime graceMinutes")
    .lean<{ workSchedule?: { timeZone?: string; loginTime?: string; logoutTime?: string; graceMinutes?: number } | null } | null>();
  const schedule = shiftFor(user?.workSchedule ?? null);

  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const calendar = await attendance.calendar(month, String(employee._id));
  const days = calendar.employees[0]?.days ?? {};
  const todayKey = todayInTz(schedule.timeZone, now);

  const at = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: schedule.timeZone, hour12: false }).format(d);

  const out: FlaggedDay[] = [];
  for (const [date, day] of Object.entries(days) as [string, { status: string; checkIn?: Date | null; checkOut?: Date | null; regularization?: unknown }][]) {
    // The month so far, not the days still to come.
    if (date > todayKey) continue;
    // Already being fixed, or already fixed — nothing to prompt here.
    if (day.regularization) continue;

    const checkIn = day.checkIn ? at(new Date(day.checkIn)) : null;
    const checkOut = day.checkOut ? at(new Date(day.checkOut)) : null;

    if (day.status === "absent") { out.push({ date, kind: "not_marked", checkIn, checkOut }); continue; }
    if (day.status === "half_day") out.push({ date, kind: "half_day", checkIn, checkOut });
    else if (day.status === "late") out.push({ date, kind: "late", checkIn, checkOut });

    if (day.checkOut) {
      // Noon on that calendar date resolves to that date's own shift end,
      // whichever timezone the schedule is in — the org only spans Dubai and
      // Kolkata, both comfortably inside noon UTC's twelve hours of slack.
      const shift = resolveShift(schedule, new Date(`${date}T12:00:00.000Z`));
      const earlyThreshold = shift.shiftEnd.getTime() - schedule.graceMinutes * 60_000;
      if (new Date(day.checkOut).getTime() < earlyThreshold) {
        out.push({ date, kind: "early_out", checkIn, checkOut });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

function buildHtml(name: string, rows: FlaggedDay[], monthLabel: string) {
  const body = rows
    .map((r) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-variant-numeric:tabular-nums">${new Date(r.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${LABEL[r.kind]}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;font-variant-numeric:tabular-nums">${r.checkIn ?? "—"}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;font-variant-numeric:tabular-nums">${r.checkOut ?? "—"}</td>
    </tr>`)
    .join("");
  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">
    <h2 style="color:#4f46e5;margin-bottom:4px">Worth a second look</h2>
    <p style="color:#555">Hi ${name}, ${rows.length} day${rows.length === 1 ? "" : "s"} in ${monthLabel} could use a correction if something was missed:</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;margin:12px 0">
      <thead><tr style="text-align:left;color:#888;font-size:12px;text-transform:uppercase">
        <th style="padding:8px 12px">Date</th><th style="padding:8px 12px">What</th>
        <th style="padding:8px 12px">In</th><th style="padding:8px 12px">Out</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p><a href="${env.CLIENT_URL}/regularization" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Raise a correction</a></p>
    <p style="color:#999;font-size:12px;margin-top:20px">Already right, or already raised? Nothing to do — this is just a nudge, sent once a week.</p>
  </div>`;
}

const asText = (rows: FlaggedDay[]) =>
  rows.map((r) => `${r.date} — ${LABEL[r.kind]} (in ${r.checkIn ?? "—"}, out ${r.checkOut ?? "—"})`).join("\n");

export async function runRegularizationPrompt(now = new Date()) {
  const orgs = await Organization.find({ status: "active" }).select("_id").lean();
  const monthLabel = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  let flagged = 0, sent = 0;

  for (const org of orgs) {
    const employees = await Employee.find({ organization: org._id, status: { $ne: "terminated" }, user: { $ne: null } })
      .select("name user")
      .lean();
    if (!employees.length) continue;

    const users = await User.find({ _id: { $in: employees.map((e) => e.user) }, status: { $ne: "inactive" } })
      .select("email")
      .lean();
    const emailByUser = new Map(users.map((u) => [String(u._id), u.email]));

    for (const e of employees) {
      const email = emailByUser.get(String(e.user));
      if (!email) continue;

      const rows = await flaggedDaysThisMonth(String(e.user), org._id, now);
      if (!rows.length) continue;
      flagged++;

      const ok = await sendMail({
        organization: org._id,
        to: email,
        subject: `${rows.length} day${rows.length === 1 ? "" : "s"} worth a second look this month`,
        html: buildHtml(String(e.name ?? "there"), rows, monthLabel),
        text: asText(rows),
      });
      if (ok) sent++;
    }
  }

  if (!flagged) console.log("📋 regularisation prompt: nothing to report.");
  else console.log(`📋 regularisation prompt: ${flagged} employee(s) flagged, ${sent} email(s).`);
  return { flagged, emails: sent };
}

export function startRegularizationPromptCron() {
  const expr = cronSetting("REGULARIZATION_PROMPT_CRON", env.REGULARIZATION_PROMPT_CRON);
  if (!expr) return;
  cron.schedule(expr, () => {
    runRegularizationPrompt().catch((e) => console.error("📋 regularisation prompt failed:", e));
  });
  console.log(`📋 regularisation prompt cron scheduled: "${expr}"`);
}
