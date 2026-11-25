import cron from "node-cron";
import { cronSetting } from "../utils/cronSetting.js";
import { env } from "../config/env.js";
import { runTaskJob } from "../services/taskSeriesService.js";

/** Tasks (Part 2): repeating tasks' copies, overdue notices and the 8 am list. See runTaskJob. */
export function startTaskCron() {
  const expr = cronSetting("TASK_CRON", env.TASK_CRON);
  if (!expr) return;
  cron.schedule(expr, () => {
    runTaskJob().catch((e) => console.error("📋 task job failed:", e));
  });
  console.log(`📋 task cron scheduled: "${expr}"`);
}
