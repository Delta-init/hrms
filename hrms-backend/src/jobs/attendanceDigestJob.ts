import cron from "node-cron";
import { cronSetting } from "../utils/cronSetting.js";
import { Attendance } from "../models/Attendance.js";
import { Employee } from "../models/Employee.js";
import { Holiday } from "../models/Holiday.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Organization } from "../models/Organization.js";
import { User } from "../models/User.js";
import { WorkSchedule } from "../models/WorkSchedule.js";
import { env } from "../config/env.js";
import { sendMail } from "../utils/mailer.js";
import { hrRecipients } from "./birthdayJob.js";
import { DEFAULT_SCHEDULE, localDayKey, resolveShift, type ShiftSchedule } from "../utils/schedule.js";
import { holidayScope } from "../utils/holidayScope.js";

/**
 * What went wrong today, to HR, at the end of the day.
 *
 * Exceptions only. A roll-call of ninety-nine people who all turned up is a
 * mail nobody reads twice, and the one line that mattered is buried in it. The
 * days worth a person's attention are the ones where something did not happen:
 * nobody clocked in, nobody clocked out, somebody arrived late, or a punch came
 * from a machine or a place it usually does not.
 *
 * Nothing wrong means nothing sent. A daily "0 exceptions" trains the reader to
 * delete it unopened, and then the day it is not empty gets deleted too.
 *
 * Sent after the last shift closes rather than at midnight, so it describes a
 * day that has finished and is still the day the reader is thinking about.
 */

export type Kind = "no_punch" | "still_open" | "late" | "half_day" | "device" | "moved";

export interface Exception {
  name: string;
  code: string;
  kind: Kind;
  detail: string;
}

export const LABEL: Record<Kind, string> = {
  no_punch: "Never clocked in",
  still_open: "Still clocked in",
  late: "Late",
  half_day: "Half day",
  device: "Unrecognised device",
  moved: "Clocked out elsewhere",
};

/** Ordered so the ones needing action come before the ones needing a glance. */
const ORDER: Kind[] = ["no_punch", "still_open", "device", "moved", "half_day", "late"];

function shiftFor(ws: { timeZone?: string; loginTime?: string; logoutTime?: string; graceMinutes?: number } | null): ShiftSchedule {
  if (!ws?.timeZone) return DEFAULT_SCHEDULE;
  return {
    timeZone: ws.timeZone,
    loginTime: ws.loginTime ?? DEFAULT_SCHEDULE.loginTime,
    logoutTime: ws.logoutTime ?? DEFAULT_SCHEDULE.logoutTime,
    graceMinutes: ws.graceMinutes ?? 15,
  };
}

/** Metres between two points — the same rule the attendance list uses. */
function metresBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6_371_000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
const SAME_PLACE_M = 1_000;

/**
 * Exported so what would be reported can be inspected without sending anything.
 * A digest is worth checking against real data before it reaches HR's inbox,
 * and the only safe way to do that is to run the half that reads and stop.
 */
export async function exceptionsFor(orgId: unknown, now: Date): Promise<Exception[]> {
  const employees = await Employee.find({ organization: orgId, status: { $ne: "terminated" }, user: { $ne: null } })
    .select("name employeeCode user workMode")
    .lean();
  if (!employees.length) return [];

  const users = await User.find({ _id: { $in: employees.map((e) => e.user) }, status: { $ne: "inactive" } })
    .select("workSchedule")
    .lean();
  const schedules = await WorkSchedule.find({ organization: orgId })
    .select("timeZone loginTime logoutTime graceMinutes")
    .lean();
  const byId = new Map(schedules.map((w) => [String(w._id), w]));
  const byUser = new Map(users.map((u) => [String(u._id), u]));

  const out: Exception[] = [];
  for (const e of employees) {
    const u = byUser.get(String(e.user));
    if (!u) continue;
    const schedule = shiftFor(u.workSchedule ? byId.get(String(u.workSchedule)) ?? null : null);
    const shift = resolveShift(schedule, now);
    const day = localDayKey(now, schedule.timeZone);
    const name = String(e.name ?? "");
    const code = String(e.employeeCode ?? "");

    const att = await Attendance.findOne({ organization: orgId, user: e.user, localDay: day })
      .select("checkIn checkOut status sessions")
      .lean<{ checkIn?: Date | null; checkOut?: Date | null; status?: string; sessions?: unknown } | null>();

    if (!att?.checkIn) {
      // Only where the day was actually expected. Leave and holidays are not
      // exceptions — they are the day being accounted for.
      const dayStart = shift.dateMidnightUtc;
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      const workMode = (e as { workMode?: "office" | "wfh" }).workMode ?? null;
      const [onLeave, holiday] = await Promise.all([
        LeaveRequest.exists({ user: e.user, status: "approved", startDate: { $lt: dayEnd }, endDate: { $gte: dayStart } }),
        // Their own calendar, so a Kerala holiday does not quietly drop a Dubai
        // employee out of the exceptions HR is reading.
        Holiday.exists({ organization: orgId, date: { $gte: dayStart, $lt: dayEnd }, ...holidayScope(workMode) }),
      ]);
      if (onLeave || holiday) continue;
      if (att?.status && !["present", "late", "half_day"].includes(att.status)) continue;
      out.push({ name, code, kind: "no_punch", detail: `Shift was ${schedule.loginTime}–${schedule.logoutTime}` });
      continue;
    }

    const at = (d: Date) =>
      new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: schedule.timeZone, hour12: false }).format(d);

    if (!att.checkOut) {
      out.push({ name, code, kind: "still_open", detail: `In at ${at(att.checkIn)}, never out` });
      continue;
    }
    if (att.status === "half_day") out.push({ name, code, kind: "half_day", detail: `In at ${at(att.checkIn)}` });
    else if (att.status === "late") out.push({ name, code, kind: "late", detail: `In at ${at(att.checkIn)}` });

    const sessions = (att.sessions ?? []) as Array<{
      checkInSource?: { deviceAnomaly?: string | null; deviceLabel?: string | null; latitude?: number | null; longitude?: number | null } | null;
      checkOutSource?: { deviceLabel?: string | null; latitude?: number | null; longitude?: number | null } | null;
    }>;
    const anomaly = sessions.flatMap((s) => [s?.checkInSource?.deviceAnomaly]).find(Boolean);
    if (anomaly) out.push({ name, code, kind: "device", detail: String(anomaly).replace(/_/g, " ") });

    const a = sessions.find((s) => s?.checkInSource)?.checkInSource ?? null;
    const b = [...sessions].reverse().find((s) => s?.checkOutSource)?.checkOutSource ?? null;
    if (typeof a?.latitude === "number" && typeof a?.longitude === "number" &&
        typeof b?.latitude === "number" && typeof b?.longitude === "number") {
      const m = metresBetween(
        { latitude: a.latitude, longitude: a.longitude },
        { latitude: b.latitude, longitude: b.longitude }
      );
      if (m > SAME_PLACE_M) {
        out.push({ name, code, kind: "moved", detail: `${(m / 1000).toFixed(1)} km between in and out` });
      }
    }
  }

  return out.sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind) || x.name.localeCompare(y.name));
}

function buildHtml(rows: Exception[], dateLabel: string, headcount: number) {
  const counts = ORDER.map((k) => ({ k, n: rows.filter((r) => r.kind === k).length })).filter((c) => c.n > 0);
  const chips = counts
    .map((c) => `<span style="display:inline-block;background:#eef2ff;color:#4338ca;border-radius:999px;padding:3px 10px;font-size:12px;margin:0 6px 6px 0">${LABEL[c.k]}: ${c.n}</span>`)
    .join("");
  const body = rows
    .map((r) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600">${r.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666;font-family:ui-monospace,monospace;font-size:12px">${r.code}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${LABEL[r.kind]}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#666">${r.detail}</td>
    </tr>`)
    .join("");
  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:640px;margin:auto">
    <h2 style="color:#4f46e5;margin-bottom:4px">Attendance exceptions — ${dateLabel}</h2>
    <p style="color:#555;margin-top:0">${rows.length} thing${rows.length === 1 ? "" : "s"} to look at, out of ${headcount} staff. Everyone else's day was ordinary and is not listed.</p>
    <div style="margin:12px 0">${chips}</div>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <thead><tr style="text-align:left;color:#888;font-size:12px;text-transform:uppercase">
        <th style="padding:8px 12px">Name</th><th style="padding:8px 12px">Code</th>
        <th style="padding:8px 12px">What</th><th style="padding:8px 12px">Detail</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p style="margin-top:18px"><a href="${env.CLIENT_URL}/attendance" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open attendance</a></p>
    <p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS. Nothing to report means no email.</p>
  </div>`;
}

export async function runAttendanceDigest(now = new Date()) {
  const orgs = await Organization.find({ status: "active" }).select("_id name").lean();
  const dateLabel = now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  let sent = 0, total = 0;

  for (const org of orgs) {
    const rows = await exceptionsFor(org._id, now);
    total += rows.length;
    if (!rows.length) continue;

    const recipients = await hrRecipients(String(org._id));
    if (!recipients.length) {
      console.log(`📋 ${org.name}: ${rows.length} exception(s) but no HR recipients — skipped.`);
      continue;
    }
    const headcount = await Employee.countDocuments({ organization: org._id, status: { $ne: "terminated" }, user: { $ne: null } });
    const ok = await sendMail({
      organization: org._id,
      to: recipients,
      subject: `Attendance: ${rows.length} exception${rows.length === 1 ? "" : "s"} — ${dateLabel}`,
      html: buildHtml(rows, dateLabel, headcount),
      text: rows.map((r) => `${r.code} ${r.name} — ${LABEL[r.kind]} (${r.detail})`).join("\n"),
    });
    if (ok) sent++;
  }

  if (!total) console.log("📋 attendance digest: nothing to report.");
  else console.log(`📋 attendance digest: ${total} exception(s), ${sent} email(s).`);
  return { exceptions: total, emails: sent };
}

export function startAttendanceDigestCron() {
  const expr = cronSetting("ATTENDANCE_DIGEST_CRON", env.ATTENDANCE_DIGEST_CRON);
  if (!expr) return;
  cron.schedule(expr, () => {
    runAttendanceDigest().catch((e) => console.error("📋 attendance digest failed:", e));
  });
  console.log(`📋 attendance digest cron scheduled: "${expr}"`);
}
