import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Attendance } from "../models/Attendance.js";
import { User } from "../models/User.js";
import { Payslip } from "../models/Payslip.js";
import { Employee } from "../models/Employee.js";
import { MigrationJournal, MigrationRun } from "../models/MigrationJournal.js";
import { laterRecord } from "../utils/attendanceDay.js";

/**
 * Merge attendance days that have two records into one.
 *
 * A punch filed under one time zone and a correction filed under another —
 * Kolkata's midnight is ninety minutes before Dubai's — were not recognised as
 * the same day, so the correction was added beside the punch instead of
 * replacing it, and pay counted both. The writers now find a day by the day
 * itself and pay counts one record per day; this clears the duplicates that
 * were already there.
 *
 * Of each day's records the one changed last stays — a correction is always a
 * later change than the punch it corrects — and the rest are removed. Every
 * removed record is written whole to the migration journal first, so the run
 * can be undone and the records put back exactly:
 *
 *   bun src/seeds/mergeDuplicateAttendance.ts             # dry run: lists every day
 *   bun src/seeds/mergeDuplicateAttendance.ts --apply
 *   bun run migrate:greythr:revert -- --run=<run id> --apply
 *
 * It never touches payslips. Months already issued or paid are listed, since
 * what was docked there was settled on the old count.
 */

const APPLY = process.argv.includes("--apply");
const MIGRATION = "merge-duplicate-attendance";
const RUN = `dedupe-attendance-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const log = (s = "") => console.log(s);
const at = (d?: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "—");
const zone = (tz?: string | null) => (tz ?? "").replace(/^Asia\//, "");

type Rec = Awaited<ReturnType<typeof loadGroup>>[number];
const loadGroup = (ids: mongoose.Types.ObjectId[]) => Attendance.find({ _id: { $in: ids } }).lean();

async function main() {
  log(`\n${APPLY ? "APPLYING" : "DRY RUN — nothing will be written"}`);
  // The server owns the indexes; this only reads and removes records.
  mongoose.set("autoIndex", false);
  await mongoose.connect(env.MONGODB_URI);

  const groups = await Attendance.aggregate<{ _id: { user: mongoose.Types.ObjectId; day: string }; ids: mongoose.Types.ObjectId[] }>([
    { $match: { localDay: { $ne: null } } },
    { $group: { _id: { user: "$user", day: "$localDay" }, ids: { $push: "$_id" }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $sort: { "_id.day": 1 } },
  ]);
  if (!groups.length) { log("\n  No day has more than one record. Nothing to do.\n"); await mongoose.disconnect(); return; }

  const names = new Map<string, string>();
  for (const u of await User.find({ _id: { $in: groups.map((g) => g._id.user) } }).select("name").lean()) names.set(String(u._id), u.name ?? "?");

  const plan: { user: string; day: string; keep: Rec; remove: Rec[] }[] = [];
  for (const g of groups) {
    const recs = await loadGroup(g.ids);
    if (recs.length < 2) continue;
    const keep = recs.reduce((a, b) => laterRecord(a, b));
    plan.push({ user: String(g._id.user), day: g._id.day, keep, remove: recs.filter((r) => String(r._id) !== String(keep._id)) });
  }

  log(`\n── ${plan.length} days with more than one record ${"─".repeat(24)}`);
  for (const p of plan) {
    const k = p.keep;
    log(`  ${p.day}  ${(names.get(p.user) ?? p.user).padEnd(18)} keep ${String(k.status).padEnd(9)} ${zone(k.timeZone).padEnd(8)} changed ${at(k.updatedAt as Date)}`);
    for (const r of p.remove) {
      log(`  ${"".padEnd(10)}  ${"".padEnd(18)} drop ${String(r.status).padEnd(9)} ${zone(r.timeZone).padEnd(8)} changed ${at(r.updatedAt as Date)}`);
    }
  }
  const removing = plan.reduce((n, p) => n + p.remove.length, 0);

  // What was already settled on the old count. Nothing here is changed.
  const months = new Map<string, Set<string>>();
  for (const p of plan) {
    const m = p.day.slice(0, 7);
    if (!months.has(p.user)) months.set(p.user, new Set());
    months.get(p.user)!.add(m);
  }
  const settled: string[] = [];
  for (const [user, ms] of months) {
    const emp = await Employee.findOne({ user }).select("_id").lean();
    if (!emp) continue;
    for (const m of ms) {
      const slip = await Payslip.findOne({ employee: emp._id, month: m }).select("status").lean<{ status?: string } | null>();
      if (slip && ["issued", "paid"].includes(slip.status ?? "")) settled.push(`${names.get(user) ?? user} · ${m} · payslip ${slip.status}`);
    }
  }
  if (settled.length) {
    log(`\n── Already paid on the old count (not changed here) ${"─".repeat(10)}`);
    for (const s of settled) log(`  ${s}`);
  }

  if (APPLY) {
    await MigrationRun.create({ run: RUN, migration: MIGRATION, source: "duplicate attendance days" });
    let removed = 0;
    for (const p of plan) {
      for (const r of p.remove) {
        // Still a duplicate? Someone may have merged it by hand since the list was read.
        const others = await Attendance.countDocuments({ user: r.user, localDay: p.day, _id: { $ne: r._id } });
        if (!others) continue;
        // Journal first, whole: undoing the run puts the record back exactly.
        await MigrationJournal.create({ run: RUN, migration: MIGRATION, collectionName: Attendance.collection.name, documentId: r._id, before: r });
        await Attendance.deleteOne({ _id: r._id });
        removed++;
      }
    }
    await MigrationRun.updateOne({ run: RUN }, { $set: { created: 0, updated: removed, finishedAt: new Date(), stats: { days: plan.length, removed } } });
    log(`\n  merged ${plan.length} days · removed ${removed} records · run id ${RUN}`);
    log(`  undo it with:  bun run migrate:greythr:revert -- --run=${RUN} --apply\n`);
  } else {
    log(`\n  ${plan.length} days · ${removing} records would be removed. Re-run with --apply to merge.\n`);
  }
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error("\nMerge failed:", e instanceof Error ? e.message : e);
  await mongoose.disconnect();
  process.exit(1);
});
