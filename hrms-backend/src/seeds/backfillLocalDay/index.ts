/**
 * Write the local day onto attendance recorded before the field existed.
 *
 * A record's `date` is midnight in the person's own zone, so one calendar day
 * is a different instant for each of them: 20:00Z for Asia/Dubai, 18:30Z for
 * Asia/Kolkata. Any filter over a range of instants has to pick one zone and is
 * then wrong for everybody else — asking for today returned the Dubai staff,
 * dropped all thirty on Kolkata time, and quietly included their records for
 * tomorrow instead.
 *
 * Filtering now matches `localDay`, the day written plainly. New records get it
 * on save; this fills it in for the ones already stored.
 *
 *   bun src/seeds/backfillLocalDay/index.ts            # show what would be written
 *   bun src/seeds/backfillLocalDay/index.ts --apply
 */
import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../../config/env.js";
import { Attendance } from "../../models/Attendance.js";
import { localDayKey } from "../../utils/schedule.js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");

const log = (m = "") => console.log(m);

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  log(`Mode : ${APPLY ? "APPLY — the day is written" : "DRY RUN — nothing is written"}`);

  // Every record, not only those missing the field: a record whose timezone was
  // corrected has a stale day, and it is cheaper to check all of them than to
  // reason about which corrections happened before the field existed.
  const records = await Attendance.find({}).select("date timeZone localDay user").lean();
  log(`Records : ${records.length}`);

  let wrote = 0, already = 0;
  const byDay = new Map<string, number>();
  for (const r of records) {
    const want = localDayKey(r.date, r.timeZone || "Asia/Dubai");
    byDay.set(want, (byDay.get(want) ?? 0) + 1);
    if (r.localDay === want) { already++; continue; }
    if (APPLY) {
      // updateOne rather than save(): nothing else about the record should
      // move, and the pre-save hook would recompute the other mirrors too.
      await Attendance.updateOne({ _id: r._id }, { $set: { localDay: want } });
    }
    wrote++;
  }

  log(`\n  ${wrote} ${APPLY ? "written" : "would be written"} · ${already} already correct`);
  log(`\n  records per day, as they will now be found:`);
  for (const [day, n] of [...byDay].sort()) log(`      ${day}  ${n}`);

  if (!APPLY) log(`\n  Nothing was written. Re-run with --apply.`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
