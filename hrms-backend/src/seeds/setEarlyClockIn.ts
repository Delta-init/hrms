/**
 * Set how early clock-in opens on every work schedule.
 *
 * Schedules written before `earlyClockInMinutes` existed have no value and
 * open the old fixed 30 minutes before the shift. This sets them all to the
 * chosen figure — 180 (three hours) unless told otherwise.
 *
 *     bun src/seeds/setEarlyClockIn.ts                    # report only
 *     bun src/seeds/setEarlyClockIn.ts --apply            # set 180 everywhere
 *     bun src/seeds/setEarlyClockIn.ts --minutes 120 --apply
 *
 * Safe to re-run: a schedule already at the figure is left alone.
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { WorkSchedule } from "../models/WorkSchedule.js";
import { User } from "../models/User.js";

async function main() {
  const apply = process.argv.includes("--apply");
  const at = process.argv.indexOf("--minutes");
  const minutes = at > -1 ? Number(process.argv[at + 1]) : 180;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 240) throw new Error("--minutes must be a whole number from 0 to 240");

  await connectDB();
  console.log(`Mode: ${apply ? "APPLY" : "dry run"} · clock-in opens ${minutes} minutes before the shift\n`);

  const schedules = await WorkSchedule.find({}).select("name loginTime earlyClockInMinutes").sort({ name: 1 }).lean<Array<{ _id: unknown; name: string; loginTime: string; earlyClockInMinutes?: number }>>();
  let changed = 0;
  for (const s of schedules) {
    const people = await User.countDocuments({ workSchedule: s._id });
    const now = s.earlyClockInMinutes ?? 30;
    const [h, m] = s.loginTime.split(":").map(Number);
    const opens = ((h * 60 + m - minutes) % 1440 + 1440) % 1440;
    const opensAt = `${String(Math.floor(opens / 60)).padStart(2, "0")}:${String(opens % 60).padStart(2, "0")}`;
    if (now === minutes && s.earlyClockInMinutes !== undefined) {
      console.log(`  ${s.name.padEnd(40)} ${String(people).padStart(3)} people · already ${minutes}`);
      continue;
    }
    console.log(`  ${s.name.padEnd(40)} ${String(people).padStart(3)} people · ${now} → ${minutes} min (shift ${s.loginTime}, opens ${opensAt})`);
    if (apply) await WorkSchedule.updateOne({ _id: s._id }, { $set: { earlyClockInMinutes: minutes } });
    changed++;
  }

  console.log(`\n${changed} schedule(s) ${apply ? "updated" : "would change"}.`);
  if (!apply) console.log("Dry run — re-run with --apply to write.");
  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
