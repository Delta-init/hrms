import cron from "node-cron";
import { cronSetting } from "../utils/cronSetting.js";
import { Organization } from "../models/Organization.js";
import { runVisaReminders } from "../services/visaReminderService.js";
import { runWithOrg } from "../utils/orgContext.js";
import { env } from "../config/env.js";

/** Each morning: visa reminders for whoever is due, organisation by organisation. */
function withOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    runWithOrg({ orgId, isSuperAdmin: false }, () => { fn().then(resolve, reject); });
  });
}

export async function runVisaReminderJob(now = new Date()) {
  const orgs = await Organization.find({ status: { $ne: "inactive" } }).select("_id").lean();
  let due = 0;
  for (const org of orgs) {
    try {
      due += (await withOrg(String(org._id), () => runVisaReminders(now))).due;
    } catch (e) {
      console.error(`🛂 visa reminders: ${org._id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  if (due) console.log(`🛂 visa reminders sent for ${due} employee(s)`);
  return due;
}

export function startVisaReminderCron() {
  const expr = cronSetting("VISA_REMINDER_CRON", env.VISA_REMINDER_CRON);
  if (!expr) return;
  cron.schedule(expr, () => {
    runVisaReminderJob().catch((e) => console.error("🛂 visa reminder run failed:", e));
  });
  console.log(`🛂 visa reminder cron scheduled: "${expr}"`);
}
