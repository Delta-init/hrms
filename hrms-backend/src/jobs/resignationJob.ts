import cron from "node-cron";
import { ResignationService } from "../services/resignationService.js";

const service = new ResignationService();

/** Relieve accepted resignations whose last working day has passed. */
export async function runResignationRelieve(now = new Date()) {
  const count = await service.autoRelieveDue(now);
  if (count > 0) console.log(`👋 auto-relieved ${count} employee(s) whose notice period ended.`);
  return count;
}

/** Schedule the daily relieve check (just after midnight, server local time). */
export function startResignationCron() {
  const expr = "5 0 * * *";
  cron.schedule(expr, () => {
    runResignationRelieve().catch((e) => console.error("👋 resignation relieve job failed:", e));
  });
  console.log(`👋 resignation relieve cron scheduled: "${expr}"`);
}
