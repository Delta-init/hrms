import cron from "node-cron";
import { cronSetting } from "../utils/cronSetting.js";
import { env } from "../config/env.js";
import { runDgoDailyAll } from "../services/dgo/dgoDailyService.js";

/**
 * DGO Points' nightly run (services/dgo/dgoDailyService.ts): leavers, expiry,
 * expiry warnings, approval nudges and the wallet recount. Dubai time, so
 * "today" is the day the organisation works in; once per organisation per day
 * however many servers run it.
 */
export function startDgoPointsCron(): void {
  const expr = cronSetting("DGO_POINTS_CRON", env.DGO_POINTS_CRON);
  if (!expr) return;
  cron.schedule(expr, () => {
    runDgoDailyAll()
      .then((r) => { if (r.length) console.log(`💎 DGO Points nightly: ${JSON.stringify(r)}`); })
      .catch((err) => console.error("💎 DGO Points nightly failed:", err instanceof Error ? err.message : err));
  }, { timezone: "Asia/Dubai" });
  console.log(`💎 DGO Points nightly scheduled: "${expr}" (Dubai)`);
}
