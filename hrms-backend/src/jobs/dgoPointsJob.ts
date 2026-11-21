import cron from "node-cron";
import { cronSetting } from "../utils/cronSetting.js";
import { env } from "../config/env.js";
import { runDgoDailyAll } from "../services/dgo/dgoDailyService.js";
import { importKpiNightly } from "../services/dgo/dgoKpiImportService.js";

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

  // Sales KPI points from Root's daily tracker, late in the Dubai day: today, and yesterday again.
  const kpi = cronSetting("DGO_KPI_CRON", env.DGO_KPI_CRON);
  if (!kpi) return;
  cron.schedule(kpi, () => {
    importKpiNightly()
      .then((r) => { if (r.length) console.log(`💎 DGO KPI import: ${r.map((x) => x.message).join(" | ")}`); })
      .catch((err) => console.error("💎 DGO KPI import failed:", err instanceof Error ? err.message : err));
  }, { timezone: "Asia/Dubai" });
  console.log(`💎 DGO KPI import scheduled: "${kpi}" (Dubai)`);
}
