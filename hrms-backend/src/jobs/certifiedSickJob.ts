import cron from "node-cron";
import { cronSetting } from "../utils/cronSetting.js";
import { env } from "../config/env.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { notify } from "../services/notificationService.js";
import { CERTIFIED_SICK } from "../services/leaveService.js";

/**
 * Certified Sick Leave's deadline.
 *
 * A request still without its medical certificate when the five hours are up
 * becomes unpaid leave — still leave, not an absence, just not paid — and the
 * employee is told. An hour before that, they get one reminder.
 */
export async function runCertifiedSickDeadlines(now = new Date()) {
  const base = { type: CERTIFIED_SICK, status: "pending", certificate: null };

  // One reminder, an hour before the deadline.
  const soon = await LeaveRequest.find({
    ...base, certificateReminderAt: null,
    certificateDueAt: { $gt: now, $lte: new Date(now.getTime() + 3600_000) },
  }).select("user organization certificateDueAt timeZone").lean();
  for (const r of soon) {
    const done = await LeaveRequest.updateOne({ _id: r._id, certificateReminderAt: null }, { $set: { certificateReminderAt: now } });
    if (!done.modifiedCount) continue;
    const at = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: r.timeZone || "Asia/Dubai" }).format(r.certificateDueAt!);
    await notify({
      users: [String(r.user)], organization: r.organization, kind: "leave",
      title: `Medical certificate due by ${at}`,
      body: "Upload it to your Certified Sick Leave request, or the day becomes unpaid leave.",
      href: "/leave",
    }).catch(() => null);
  }

  // Past the deadline with nothing uploaded: unpaid.
  const late = await LeaveRequest.find({ ...base, certificateDueAt: { $lte: now } }).select("user organization").lean();
  let converted = 0;
  for (const r of late) {
    const done = await LeaveRequest.updateOne(
      { _id: r._id, ...base },
      { $set: {
        status: "approved", type: "unpaid", convertedFrom: CERTIFIED_SICK, conversionReason: "no_certificate",
        reviewedAt: now, reviewNote: "No medical certificate within 5 hours — counted as unpaid leave.",
      } }
    );
    if (!done.modifiedCount) continue;
    converted++;
    await notify({
      users: [String(r.user)], organization: r.organization, kind: "leave", tone: "negative",
      title: "Certified sick leave became unpaid leave",
      body: "No medical certificate was uploaded within 5 hours.",
      href: "/leave",
    }).catch(() => null);
  }
  if (converted) console.log(`🩺 certified sick: ${converted} request(s) without a certificate became unpaid leave.`);
  return { reminded: soon.length, converted };
}

export function startCertifiedSickCron() {
  const expr = cronSetting("CERTIFIED_SICK_CRON", env.CERTIFIED_SICK_CRON);
  if (!expr) return;
  cron.schedule(expr, () => {
    runCertifiedSickDeadlines().catch((e) => console.error("🩺 certified sick job failed:", e));
  });
  console.log(`🩺 certified sick deadline cron scheduled: "${expr}"`);
}
