import cron from "node-cron";
import { cronSetting } from "../utils/cronSetting.js";
import { env } from "../config/env.js";
import { BackupService, RETENTION_DAYS } from "../services/backupService.js";

/**
 * A full copy of the database, once a night.
 *
 * Overnight because it reads every collection, and because a backup taken at
 * the end of a working day is the one somebody actually wants back — a copy
 * from midday is missing the afternoon that went wrong.
 *
 * Pruning runs in the same pass rather than on a timer of its own. Two jobs
 * that must agree about the retention window is one more thing to keep in
 * step, and the moment a new archive exists is exactly when the oldest stops
 * being needed.
 *
 * Off is a valid setting, like every other job here — BACKUP_CRON=off.
 */
const service = new BackupService();

export async function runNightlyBackup() {
  try {
    const record = await service.run("scheduled");
    const t = record.totals;
    console.log(
      `💾 backup: ${t?.included}/${t?.collections} collections, ${t?.documents} documents, ` +
      `${((record.bytes ?? 0) / 1024).toFixed(0)} KB in ${((record.durationMs ?? 0) / 1000).toFixed(1)}s`
    );
    // Said out loud rather than left in the record: a collection that stopped
    // being readable is the kind of thing that goes unnoticed for months.
    const bad = (record.collections ?? []).filter((c: { status: string }) => c.status === "failed");
    if (bad.length) console.error(`💾 backup: ${bad.length} collection(s) could not be read: ${bad.map((c: { name: string }) => c.name).join(", ")}`);

    const { removed } = await service.prune(RETENTION_DAYS);
    if (removed) console.log(`💾 backup: pruned ${removed} archive(s) older than ${RETENTION_DAYS} days.`);
    return record;
  } catch (e) {
    // Loud, because a backup that fails quietly is indistinguishable from one
    // that never ran until the day somebody needs it.
    console.error("💾 backup FAILED:", e instanceof Error ? e.message : e);
    throw e;
  }
}

export function startBackupCron() {
  const expr = cronSetting("BACKUP_CRON", env.BACKUP_CRON);
  if (!expr) return;
  cron.schedule(expr, () => {
    runNightlyBackup().catch(() => { /* already logged */ });
  });
  console.log(`💾 backup cron scheduled: "${expr}"`);
}
