import cron from "node-cron";
import { env } from "../config/env.js";
import { Attendance } from "../models/Attendance.js";
import { deleteObject } from "../services/uploadService.js";

const RETENTION_DAYS = Number(env.FACE_PROOF_RETENTION_DAYS) || 30;

/**
 * Delete the frames punches were made from once they are past their retention.
 *
 * The photo exists to settle "that wasn't me" in the days after a punch. Once
 * that window has passed it is a stack of dated photographs of staff arriving
 * at work and nothing else, so it goes — and the attendance record it belonged
 * to stays exactly as it was, minus the picture.
 */
export async function runFaceProofPurge(): Promise<{ scanned: number; deleted: number }> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);

  const records = await Attendance.find({
    date: { $lt: cutoff },
    $or: [
      { "sessions.checkInSource.proofKey": { $ne: null } },
      { "sessions.checkOutSource.proofKey": { $ne: null } },
    ],
  }).select("sessions");

  let deleted = 0;
  for (const record of records) {
    for (const session of record.sessions) {
      for (const side of ["checkInSource", "checkOutSource"] as const) {
        const key = session[side]?.proofKey;
        if (!key) continue;
        await deleteObject(key);
        session[side]!.proofKey = null;
        deleted += 1;
      }
    }
    await record.save();
  }

  if (deleted > 0) console.log(`📸 face proof purge: removed ${deleted} image(s) older than ${RETENTION_DAYS}d`);
  return { scanned: records.length, deleted };
}

export function startFaceProofPurgeCron() {
  const expr = env.FACE_PROOF_PURGE_CRON;
  if (!cron.validate(expr)) {
    console.error(`📸 invalid FACE_PROOF_PURGE_CRON "${expr}" — punch photos will not be purged.`);
    return;
  }
  cron.schedule(expr, () => {
    runFaceProofPurge().catch((e) => console.error("📸 face proof purge failed:", e));
  });
  console.log(`📸 face proof purge cron scheduled: "${expr}" (retention ${RETENTION_DAYS}d)`);
}
