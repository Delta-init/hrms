import cron from "node-cron";
import { cronSetting } from "../utils/cronSetting.js";
import { Organization } from "../models/Organization.js";
import { FirstDaysService } from "../services/firstDaysService.js";
import { runWithOrg } from "../utils/orgContext.js";
import { env } from "../config/env.js";

/**
 * Starts each new joiner's first days on the morning they join, so they,
 * their head and HR hear about it before the 10:30 session rather than when
 * somebody happens to open the app. The same thing happens lazily whenever
 * any of them does open it; this only makes sure it happens early.
 */
const service = new FirstDaysService();

function withOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    runWithOrg({ orgId, isSuperAdmin: false }, () => { fn().then(resolve, reject); });
  });
}

export async function runFirstDaysStart() {
  const orgs = await Organization.find({}).select("_id").lean();
  let started = 0;
  for (const org of orgs) {
    try {
      started += (await withOrg(String(org._id), () => service.syncOrg())).started;
    } catch (e) {
      console.error(`🌱 first days: ${org._id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  if (started) console.log(`🌱 first days started for ${started} new joiner(s)`);
}

export function startFirstDaysCron() {
  const expr = cronSetting("FIRST_DAYS_CRON", env.FIRST_DAYS_CRON);
  if (!expr) return;
  cron.schedule(expr, () => {
    runFirstDaysStart().catch((e) => console.error("🌱 first days run failed:", e));
  });
  console.log(`🌱 first days cron scheduled: "${expr}"`);
}
