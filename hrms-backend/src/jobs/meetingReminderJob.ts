import cron from "node-cron";
import { cronSetting } from "../utils/cronSetting.js";
import { env } from "../config/env.js";
import { MeetingBooking } from "../models/MeetingBooking.js";
import { Organization } from "../models/Organization.js";
import { User } from "../models/User.js";
import type { MeetingStage } from "../types/index.js";
import { sendMail } from "../utils/mailer.js";
import { notify } from "../services/notificationService.js";
import { runWithOrg } from "../utils/orgContext.js";

/**
 * A word before a meeting, and a word as it starts.
 *
 * The same shape as the reminders beside it, for the same reasons: the poll is
 * frequent because a threshold thirty minutes out is missed by a job that runs
 * hourly, and each stage is written down before the mail goes so a job running
 * twelve times an hour cannot tell twenty people about the same meeting twelve
 * times.
 *
 * Past the catch-up window a stage is marked done without sending. A "starts in
 * thirty minutes" mail arriving two hours after the meeting ended helps nobody
 * and teaches people to ignore the next one.
 */
const STAGES: MeetingStage[] = ["30min", "ontime"];
const CATCH_UP_MS: Record<MeetingStage, number> = { "30min": 20 * 60_000, ontime: 20 * 60_000 };

const COPY: Record<MeetingStage, (title: string, at: string, room: string) => { subject: string; line: string }> = {
  "30min": (title, at, room) => ({
    subject: `${title} starts in 30 minutes`,
    line: `<strong>${title}</strong> starts at ${at} in ${room} — half an hour from now.`,
  }),
  ontime: (title, at, room) => ({
    subject: `${title} is starting now`,
    line: `<strong>${title}</strong> is starting now, at ${at} in ${room}.`,
  }),
};

function thresholds(start: Date): Record<MeetingStage, Date> {
  return { "30min": new Date(start.getTime() - 30 * 60_000), ontime: new Date(start) };
}

function withOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    runWithOrg({ orgId, isSuperAdmin: false }, () => { fn().then(resolve, reject); });
  });
}

/** One organisation's meetings. Separate so it can be run against one org. */
export async function processMeetingsFor(orgId: string, now = new Date()): Promise<{ fired: number; emails: number }> {
  let fired = 0;
  let emails = 0;

  // Only what is close enough to matter: a window around now, rather than
  // every meeting ever booked.
  const from = new Date(now.getTime() - 3 * 3600_000);
  const to = new Date(now.getTime() + 3 * 3600_000);
  const bookings = await MeetingBooking.find({ organization: orgId, status: "booked", start: { $gte: from, $lte: to } })
    .populate("room", "name")
    .populate("organizer", "name email");

  for (const booking of bookings) {
    const at = thresholds(booking.start);
    let changed = false;

    for (const stage of STAGES) {
      if (booking.firedStages.includes(stage)) continue;
      if (now < at[stage]) continue;

      const staleMs = now.getTime() - at[stage].getTime();
      booking.firedStages.push(stage);
      changed = true;

      // Too late to be useful — marked done, deliberately unsent.
      if (staleMs > CATCH_UP_MS[stage]) continue;

      const room = (booking.room as unknown as { name?: string } | null)?.name ?? "the meeting room";
      const when = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit", minute: "2-digit", timeZone: booking.timeZone || "Asia/Dubai", hour12: false,
      }).format(booking.start);
      const { subject, line } = COPY[stage](booking.title, when, room);

      const recipientIds = [String(booking.organizer?._id ?? booking.organizer), ...booking.participants.map(String)];
      const unique = [...new Set(recipientIds)];

      try {
        await withOrg(orgId, () =>
          notify({ users: unique, kind: "reminder", title: subject, body: `${when} · ${room}`, href: "/meetings" })
        );
      } catch {
        /* the mail below is the part that matters */
      }

      const people = await User.find({ _id: { $in: unique }, status: { $ne: "inactive" } }).select("name email").lean();
      for (const person of people) {
        if (!person.email) continue;
        const ok = await sendMail({
          to: person.email,
          organization: orgId,
          subject,
          text: `${subject}\n\n${booking.title}\n${when} · ${room}\n` +
            (booking.agenda ? `\n${booking.agenda}\n` : "") + `\n${env.CLIENT_URL}/meetings\n`,
          html:
            `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">` +
            `<h2 style="color:#4f46e5;margin-bottom:4px">${subject}</h2>` +
            `<p style="color:#555">${line}</p>` +
            (booking.agenda ? `<p style="color:#555">${booking.agenda}</p>` : "") +
            `<p><a href="${env.CLIENT_URL}/meetings" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open meetings</a></p>` +
            `<p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS.</p></div>`,
        });
        if (ok) emails++;
      }
      fired++;
    }

    if (changed) await booking.save();
  }

  return { fired, emails };
}

export async function runMeetingReminders(now = new Date()) {
  const orgs = await Organization.find({ status: "active" }).select("_id").lean();
  let fired = 0, emails = 0;
  for (const org of orgs) {
    const r = await processMeetingsFor(String(org._id), now);
    fired += r.fired; emails += r.emails;
  }
  if (fired) console.log(`📅 meeting reminders: ${fired} stage(s), ${emails} email(s).`);
  return { fired, emails };
}

export function startMeetingReminderCron() {
  const expr = cronSetting("MEETING_REMINDER_CRON", env.MEETING_REMINDER_CRON);
  if (!expr) return;
  cron.schedule(expr, () => {
    runMeetingReminders().catch((e) => console.error("📅 meeting reminder job failed:", e));
  });
  console.log(`📅 meeting reminder cron scheduled: "${expr}"`);
}
