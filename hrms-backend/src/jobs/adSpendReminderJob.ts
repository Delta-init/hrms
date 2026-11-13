import cron from "node-cron";
import { cronSetting } from "../utils/cronSetting.js";
import { Organization } from "../models/Organization.js";
import { AdSpendService } from "../services/adSpendService.js";
import { runWithOrg } from "../utils/orgContext.js";
import { env } from "../config/env.js";

/**
 * Monday morning: "log last week's ad spend". Wednesday, for a week still not
 * in: the same, more firmly. Each organisation is asked on its own, and one
 * that has not said from when the log is owed is skipped inside the service.
 */
const service = new AdSpendService();

function withOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    runWithOrg({ orgId, isSuperAdmin: false }, () => { fn().then(resolve, reject); });
  });
}

export async function runAdSpendReminders(now = new Date()) {
  const orgs = await Organization.find({ status: { $ne: "inactive" } }).select("_id").lean();
  let sent = 0;
  for (const org of orgs) {
    try {
      sent += await withOrg(String(org._id), () => service.remindDue(now));
    } catch (e) {
      console.error(`📣 ad spend reminder: ${org._id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  if (sent) console.log(`📣 ad spend reminder sent to ${sent} person(s)`);
  return sent;
}

export function startAdSpendReminderCron() {
  const expr = cronSetting("AD_SPEND_REMIND_CRON", env.AD_SPEND_REMIND_CRON);
  if (!expr) return;
  cron.schedule(expr, () => {
    runAdSpendReminders().catch((e) => console.error("📣 ad spend reminder run failed:", e));
  });
  console.log(`📣 ad spend reminder cron scheduled: "${expr}"`);
}
