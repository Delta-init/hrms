import cron from "node-cron";
import { cronSetting } from "../utils/cronSetting.js";
import { Attendance } from "../models/Attendance.js";
import { Employee } from "../models/Employee.js";
import { Holiday } from "../models/Holiday.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Organization } from "../models/Organization.js";
import { PunchReminder } from "../models/PunchReminder.js";
import { User } from "../models/User.js";
import { WorkSchedule } from "../models/WorkSchedule.js";
import { env } from "../config/env.js";
import { sendMail } from "../utils/mailer.js";
import { DEFAULT_SCHEDULE, localDayKey, resolveShift, type ShiftSchedule } from "../utils/schedule.js";
import { holidayScope } from "../utils/holidayScope.js";

/**
 * A nudge to whoever has not clocked in, or has not clocked out.
 *
 * Both mistakes cost the person, not the company. A day never clocked into is a
 * day with no attendance against it, which the payslip reads as unaccounted;
 * a day never clocked out of records no hours at all. Neither is noticed until
 * somebody opens the attendance page, and by then the fix is an admin editing a
 * record by hand rather than the person pressing a button.
 *
 * It goes to the person alone. A list of names to a manager is a different and
 * much worse thing than telling somebody what their own record says — the same
 * reasoning as the late notice beside it.
 *
 * Runs every few minutes because a shift starts and ends at a different moment
 * for everybody: ten o'clock in Dubai and eleven-thirty in Kerala are not one
 * time to check. Every send is written down first, so a job that runs twelve
 * times an hour does not mail somebody twelve times.
 */

/** After the shift opens, before somebody is presumed to have forgotten. */
const LATE_IN_AFTER_MIN = 15;
/** After the shift ends, before a still-open day is worth a word. */
const LATE_OUT_AFTER_MIN = 15;
/**
 * Past this, a reminder is no longer a reminder.
 *
 * Somebody five hours late to clock in has either taken the day or has bigger
 * problems than a mail about it, and a message arriving at midnight about the
 * morning helps nobody. The window closes rather than the mail chasing them.
 */
const WINDOW_MIN = 120;

interface Candidate {
  userId: unknown;
  employeeName: string;
  email: string;
  schedule: ShiftSchedule;
  /** Which holiday calendar they keep — a Kerala day off is not a Dubai one. */
  workMode: "office" | "wfh" | null;
}

/** The shift a person is on, or the fallback where nobody has said. */
function shiftFor(ws: { timeZone?: string; loginTime?: string; logoutTime?: string; graceMinutes?: number } | null): ShiftSchedule {
  if (!ws?.timeZone) return DEFAULT_SCHEDULE;
  return {
    timeZone: ws.timeZone,
    loginTime: ws.loginTime ?? DEFAULT_SCHEDULE.loginTime,
    logoutTime: ws.logoutTime ?? DEFAULT_SCHEDULE.logoutTime,
    graceMinutes: ws.graceMinutes ?? 15,
  };
}

/** Everybody in one organisation who could be expected to punch today. */
async function candidatesFor(orgId: unknown): Promise<Candidate[]> {
  const employees = await Employee.find({ organization: orgId, status: { $ne: "terminated" }, user: { $ne: null } })
    .select("name user workMode")
    .lean();
  if (!employees.length) return [];

  const users = await User.find({ _id: { $in: employees.map((e) => e.user) }, status: { $ne: "inactive" } })
    .select("email workSchedule")
    .lean();
  const schedules = await WorkSchedule.find({ organization: orgId })
    .select("timeZone loginTime logoutTime graceMinutes")
    .lean();
  const byId = new Map(schedules.map((w) => [String(w._id), w]));
  const byUser = new Map(users.map((u) => [String(u._id), u]));

  const out: Candidate[] = [];
  for (const e of employees) {
    const u = byUser.get(String(e.user));
    if (!u?.email) continue;
    out.push({
      userId: e.user,
      employeeName: String(e.name ?? "there"),
      email: u.email,
      schedule: shiftFor(u.workSchedule ? byId.get(String(u.workSchedule)) ?? null : null),
      workMode: (e as { workMode?: "office" | "wfh" }).workMode ?? null,
    });
  }
  return out;
}

/** True when the day is one this person was never expected to work. */
async function excusedToday(orgId: unknown, userId: unknown, dayStart: Date, dayEnd: Date, workMode: "office" | "wfh" | null) {
  const [onLeave, holiday] = await Promise.all([
    LeaveRequest.exists({ user: userId, status: "approved", startDate: { $lt: dayEnd }, endDate: { $gte: dayStart } }),
    // Their own calendar: a Kerala holiday must not excuse a Dubai employee
    // from a punch they were expected to make.
    Holiday.exists({ organization: orgId, date: { $gte: dayStart, $lt: dayEnd }, ...holidayScope(workMode) }),
  ]);
  return !!onLeave || !!holiday;
}

/** Written before the mail, so a failure to send never repeats forever. */
async function claim(orgId: unknown, userId: unknown, localDay: string, kind: "missing_in" | "missing_out") {
  try {
    await PunchReminder.create({ organization: orgId, user: userId, localDay, kind });
    return true;
  } catch {
    // The unique index refused it: already reminded today.
    return false;
  }
}

const shell = (title: string, body: string, cta: string) =>
  `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">` +
  `<h2 style="color:#d97706;margin-bottom:4px">${title}</h2>` +
  `<p style="color:#555">${body}</p>` +
  `<p><a href="${env.CLIENT_URL}/dashboard" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">${cta}</a></p>` +
  `<p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS.</p></div>`;

export async function runPunchReminders(now = new Date()) {
  const orgs = await Organization.find({ status: "active" }).select("_id").lean();
  let missingIn = 0, missingOut = 0;

  for (const org of orgs) {
    const people = await candidatesFor(org._id);
    for (const p of people) {
      const shift = resolveShift(p.schedule, now);
      // Only days this person actually works: the shift resolver already knows
      // the week pattern, and a Sunday reminder is worse than none.
      const day = localDayKey(now, p.schedule.timeZone);
      const dayStart = shift.dateMidnightUtc;
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);

      const sinceOpen = (now.getTime() - shift.shiftStart.getTime()) / 60_000;
      const sinceClose = (now.getTime() - shift.shiftEnd.getTime()) / 60_000;
      const wantIn = sinceOpen >= LATE_IN_AFTER_MIN && sinceOpen <= WINDOW_MIN;
      const wantOut = sinceClose >= LATE_OUT_AFTER_MIN && sinceClose <= WINDOW_MIN;
      if (!wantIn && !wantOut) continue;

      const att = await Attendance.findOne({ user: p.userId, date: dayStart })
        .select("checkIn checkOut status")
        .lean<{ checkIn?: Date | null; checkOut?: Date | null; status?: string } | null>();

      if (wantIn && !att?.checkIn) {
        // A day already marked leave, holiday or absent by hand is settled;
        // reminding somebody to punch a day HR has already accounted for is
        // noise that makes every other reminder easier to ignore.
        if (att?.status && att.status !== "present" && att.status !== "late") continue;
        if (await excusedToday(org._id, p.userId, dayStart, dayEnd, p.workMode)) continue;
        if (!(await claim(org._id, p.userId, day, "missing_in"))) continue;
        const at = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: p.schedule.timeZone, hour12: false }).format(shift.shiftStart);
        const ok = await sendMail({
          to: p.email,
          organization: String(org._id),
          subject: "You have not clocked in today",
          text: `Hi ${p.employeeName},\n\nYour shift started at ${at} and there is no check-in recorded against today.\n` +
            `Clock in now if you are working: ${env.CLIENT_URL}/dashboard\n\n` +
            `If you are not working today, ask HR to record it so the day is not left unaccounted.\n`,
          html: shell(
            "You have not clocked in today",
            `Hi ${p.employeeName}, your shift started at <strong>${at}</strong> and nothing has been recorded against today yet. ` +
              `A day with no attendance against it reads as unaccounted on your payslip, so it is worth fixing now rather than at the end of the month. ` +
              `If you are not working today, ask HR to record that instead.`,
            "Clock in"
          ),
        });
        if (ok) missingIn++;
      }

      if (wantOut && att?.checkIn && !att.checkOut) {
        if (!(await claim(org._id, p.userId, day, "missing_out"))) continue;
        const at = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: p.schedule.timeZone, hour12: false }).format(shift.shiftEnd);
        const ok = await sendMail({
          to: p.email,
          organization: String(org._id),
          subject: "You are still clocked in",
          text: `Hi ${p.employeeName},\n\nYour shift ended at ${at} and you are still clocked in.\n` +
            `Clock out here: ${env.CLIENT_URL}/dashboard\n\nA day left open records no hours worked at all.\n`,
          html: shell(
            "You are still clocked in",
            `Hi ${p.employeeName}, your shift ended at <strong>${at}</strong> and today is still open. ` +
              `A day that is never clocked out of records no hours worked at all, so it is worth closing now.`,
            "Clock out"
          ),
        });
        if (ok) missingOut++;
      }
    }
  }

  if (missingIn || missingOut) {
    console.log(`⏰ punch reminders: ${missingIn} not clocked in, ${missingOut} still clocked in.`);
  }
  return { missingIn, missingOut };
}

export function startPunchReminderCron() {
  const expr = cronSetting("PUNCH_REMINDER_CRON", env.PUNCH_REMINDER_CRON);
  if (!expr) return;
  cron.schedule(expr, () => {
    runPunchReminders().catch((e) => console.error("⏰ punch reminder job failed:", e));
  });
  console.log(`⏰ punch reminder cron scheduled: "${expr}"`);
}
