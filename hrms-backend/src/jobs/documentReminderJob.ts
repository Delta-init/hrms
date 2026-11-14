import cron from "node-cron";
import { cronSetting } from "../utils/cronSetting.js";
import { Organization } from "../models/Organization.js";
import { runDocumentReminders } from "../services/documentReminderService.js";
import { runWithOrg } from "../utils/orgContext.js";
import { env } from "../config/env.js";

/** Each morning: document-expiry reminders for whoever is due, organisation by organisation. */
function withOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    runWithOrg({ orgId, isSuperAdmin: false }, () => { fn().then(resolve, reject); });
  });
}

export async function runDocumentReminderJob(now = new Date()) {
  const orgs = await Organization.find({ status: { $ne: "inactive" } }).select("_id").lean();
  let due = 0;
  for (const org of orgs) {
    try {
      due += (await withOrg(String(org._id), () => runDocumentReminders(now))).due;
    } catch (e) {
      console.error(`📄 document reminders: ${org._id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  if (due) console.log(`📄 document reminders sent for ${due} document(s)`);
  return due;
}

export function startDocumentReminderCron() {
  const expr = cronSetting("DOC_REMINDER_CRON", env.DOC_REMINDER_CRON);
  if (!expr) return;
  cron.schedule(expr, () => {
    runDocumentReminderJob().catch((e) => console.error("📄 document reminder run failed:", e));
  });
  console.log(`📄 document reminder cron scheduled: "${expr}"`);
}
