import cron from "node-cron";
import { Attendance } from "../models/Attendance.js";
import { Organization } from "../models/Organization.js";
import { User } from "../models/User.js";
import { env } from "../config/env.js";
import { sendMail } from "../utils/mailer.js";
import { getAttendancePenaltyPolicy, computeLatePenaltyDays } from "../services/attendancePenaltyService.js";
import { runWithOrg } from "../utils/orgContext.js";

/**
 * A note to whoever arrived late, the morning they arrived late.
 *
 * Lateness has always been recorded and has always mattered to pay, but the
 * only way to find out was to open the attendance page or wait for the payslip.
 * Somebody who is late three times in a month and does not notice until the
 * deduction appears has been given no chance to do anything about it.
 *
 * So it goes to the person, not to a manager: this is a nudge, not a report,
 * and a list of names circulated every morning is a different and much worse
 * thing than telling somebody what their own record says.
 *
 * It carries the month's running count and what that currently costs, because
 * "you were late" is only useful next to "and here is where that leaves you".
 * Nobody late means nothing sent — a mail that says "0 today" trains people to
 * delete it unopened.
 */

interface LateRow {
  user: unknown;
  lateMinutes: number;
}

/** Everybody marked late today, per organisation. */
async function lateToday(orgId: unknown, now: Date): Promise<LateRow[]> {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const to = new Date(from.getTime() + 86_400_000);
  return Attendance.find({ organization: orgId, status: "late", date: { $gte: from, $lt: to } })
    .select("user lateMinutes").lean<LateRow[]>();
}

/** How many times this person has been late so far this month. */
async function lateThisMonth(orgId: unknown, userId: unknown, now: Date): Promise<number> {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return Attendance.countDocuments({ organization: orgId, user: userId, status: "late", date: { $gte: from, $lt: to } });
}

export async function runLateNotices(now = new Date()) {
  const orgs = await Organization.find().select("name").lean();
  let sent = 0;
  let late = 0;

  for (const org of orgs) {
    const rows = await lateToday(org._id, now);
    if (!rows.length) continue;
    late += rows.length;

    // The penalty policy is per-organisation and read through the org context,
    // like every other consumer of it.
    const policy = await new Promise<Awaited<ReturnType<typeof getAttendancePenaltyPolicy>>>((resolve, reject) => {
      runWithOrg({ orgId: String(org._id), isSuperAdmin: false }, async () => {
        try { resolve(await getAttendancePenaltyPolicy()); } catch (e) { reject(e); }
      });
    });

    for (const row of rows) {
      const user = await User.findById(row.user).select("name email").lean<{ name?: string; email?: string } | null>();
      if (!user?.email) continue;

      const count = await lateThisMonth(org._id, row.user, now);
      const cost = computeLatePenaltyDays(count, policy);
      // What one more would cost, so the warning is about the next one rather
      // than only the one already taken.
      const nextCost = computeLatePenaltyDays(count + 1, policy);

      const day = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(now);
      const minutes = row.lateMinutes > 0 ? `${row.lateMinutes} minute${row.lateMinutes === 1 ? "" : "s"} late` : "late";
      const standing = policy.enabled
        ? cost > 0
          ? `That is ${count} this month, which currently costs ${cost} day${cost === 1 ? "" : "s"} of pay.`
          : nextCost > 0
            ? `That is ${count} this month. One more and it starts costing pay.`
            : `That is ${count} this month.`
        : `That is ${count} this month.`;

      const ok = await sendMail({
        to: user.email,
        organization: String(org._id),
        subject: `You were ${minutes} on ${day}`,
        text: `Hi ${user.name ?? "there"},\n\nToday's check-in was recorded as ${minutes}.\n${standing}\n\n` +
          `If that is wrong, raise a correction: ${env.CLIENT_URL}/regularization\n`,
        html:
          `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:auto">` +
          `<h2 style="color:#d97706;margin-bottom:4px">You were ${minutes} today</h2>` +
          `<p style="color:#555">Hi ${user.name ?? "there"}, today's check-in on ${day} was recorded as ${minutes}. ${standing}</p>` +
          `<p style="color:#555">If that is not right — a late meeting, a punch that did not register — you can ask for it to be corrected.</p>` +
          `<p><a href="${env.CLIENT_URL}/regularization" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Raise a correction</a></p>` +
          `<p style="color:#999;font-size:12px;margin-top:20px">Sent automatically by Delta HRMS.</p>` +
          `</div>`,
      });
      if (ok) sent++;
    }
  }

  if (!late) console.log("⏰ late notices: nobody late today.");
  else console.log(`⏰ late notices: ${late} late, ${sent} emailed.`);
  return { late, emailed: sent };
}

/** Schedule the morning late notice (server local time). */
export function startLateNoticeCron() {
  const expr = env.LATE_NOTICE_CRON;
  if (!cron.validate(expr)) {
    console.error(`⏰ invalid LATE_NOTICE_CRON "${expr}" — late notices disabled.`);
    return;
  }
  cron.schedule(expr, () => {
    runLateNotices().catch((e) => console.error("⏰ late notice job failed:", e));
  });
  console.log(`⏰ late notice cron scheduled: "${expr}"`);
}
