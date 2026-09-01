/**
 * Fold work schedules that are the same shift under different names into one.
 *
 * The GreytHR export named shifts however each row happened to spell them, so
 * "11.00am - 8.00pm" and "11:00 AM - 8:00 PM" arrived as two schedules holding
 * one shift. Attendance does not care — it reads the hours — but every screen
 * that asks somebody to pick a schedule offers both, and the employee filter
 * lists them as separate shifts when they are not.
 *
 * Sameness is judged on every field that changes what a schedule does: the
 * hours, the zone, the grace, the working days and the half days. Two that
 * merely start at the same time are NOT merged — one of them marking Saturday
 * a half day is a different shift wearing a similar face, and folding it away
 * would quietly change somebody's Saturday. Those are reported instead.
 *
 * The survivor is whichever name the most people already use, so the merge
 * moves as few records as it can. Rename it afterwards if another name reads
 * better — that is a rename, not a merge.
 *
 *   bun src/seeds/mergeWorkSchedules/index.ts            # show what would merge
 *   bun src/seeds/mergeWorkSchedules/index.ts --apply    # do it
 */
import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../../config/env.js";
import { Organization } from "../../models/Organization.js";
import { WorkSchedule } from "../../models/WorkSchedule.js";
import { Employee } from "../../models/Employee.js";
import { User } from "../../models/User.js";
import { RosterAssignment } from "../../models/RosterAssignment.js";
import { Holiday } from "../../models/Holiday.js";
import { LeavePolicy } from "../../models/LeavePolicy.js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const ORG_NAME = arg("org") ?? "Delta International Management Development Training";

const log = (m = "") => console.log(m);
const head = (t: string) => log(`\n── ${t} ${"─".repeat(Math.max(0, 58 - t.length))}`);

/**
 * Everything a schedule holds that changes how a day is judged.
 *
 * The name is deliberately not part of it — differing names are the whole
 * reason this exists. Anything else that differs means the shifts differ.
 */
function fingerprint(w: Record<string, unknown>): string {
  const days = (w.workDays as number[] | undefined) ?? [];
  const halves = (w.halfDays as number[] | undefined) ?? [];
  return JSON.stringify({
    loginTime: w.loginTime, logoutTime: w.logoutTime, timeZone: w.timeZone,
    graceMinutes: w.graceMinutes ?? null,
    workDays: [...days].sort(), halfDays: [...halves].sort(),
  });
}

/** Every model that points at a work schedule, so none is left dangling. */
const REFERRERS = [
  { name: "employees", model: Employee },
  { name: "logins", model: User },
  { name: "roster assignments", model: RosterAssignment },
  { name: "holidays", model: Holiday },
  { name: "leave policies", model: LeavePolicy },
] as const;

async function usage(id: unknown) {
  const counts = await Promise.all(REFERRERS.map((r) => r.model.countDocuments({ workSchedule: id })));
  return { total: counts.reduce((a, b) => a + b, 0), by: counts };
}

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const org = await Organization.findOne({ name: ORG_NAME }).lean();
  if (!org) throw new Error(`No organisation named "${ORG_NAME}"`);

  log(`Organisation : ${org.name}`);
  log(`Mode         : ${APPLY ? "APPLY — schedules are merged and the spares deleted" : "DRY RUN — nothing is written"}`);

  const schedules = await WorkSchedule.find({ organization: org._id }).lean();
  log(`Schedules    : ${schedules.length}`);

  // Group by what a schedule does, then note where the hours alone would have
  // grouped more than that — those are the ones to leave alone and report.
  const byPrint = new Map<string, typeof schedules>();
  for (const w of schedules) {
    const p = fingerprint(w as unknown as Record<string, unknown>);
    byPrint.set(p, [...(byPrint.get(p) ?? []), w]);
  }
  const byHours = new Map<string, typeof schedules>();
  for (const w of schedules) {
    const k = `${w.loginTime}–${w.logoutTime} ${w.timeZone}`;
    byHours.set(k, [...(byHours.get(k) ?? []), w]);
  }

  head("Merging");
  let merged = 0, moved = 0;
  /** Folded away, so the report below does not count them as still standing. */
  const gone = new Set<string>();
  for (const group of byPrint.values()) {
    if (group.length < 2) continue;
    const counted = await Promise.all(group.map(async (w) => ({ w, use: (await usage(w._id)).total })));
    // Most-used wins, so the fewest records have to move; a stable tie-break so
    // two runs cannot disagree about which name survives.
    counted.sort((a, b) => b.use - a.use || String(a.w.name).localeCompare(String(b.w.name)));
    const keep = counted[0];
    const drop = counted.slice(1);

    log(`\n  ${keep.w.loginTime}–${keep.w.logoutTime} ${keep.w.timeZone}`);
    log(`    keep  "${keep.w.name}"  (${keep.use} in use)`);
    for (const d of drop) {
      log(`    fold  "${d.w.name}"  (${d.use} in use)`);
      if (d.use) {
        for (const r of REFERRERS) {
          const n = await r.model.countDocuments({ workSchedule: d.w._id });
          if (!n) continue;
          log(`            ${n} ${r.name} → "${keep.w.name}"`);
          if (APPLY) await r.model.updateMany({ workSchedule: d.w._id }, { $set: { workSchedule: keep.w._id } });
          moved += n;
        }
      }
      if (APPLY) {
        // Only once nothing points at it any more. A schedule still in use is
        // left standing rather than deleted out from under a live reference.
        const left = (await usage(d.w._id)).total;
        if (left) {
          log(`            NOT deleted — ${left} references remain`);
          continue;
        }
        await WorkSchedule.deleteOne({ _id: d.w._id });
      }
      gone.add(String(d.w._id));
      merged++;
    }
  }
  if (!merged) log(`  Nothing to merge — no two schedules do the same thing.`);
  else log(`\n  ${merged} schedule${merged === 1 ? "" : "s"} ${APPLY ? "folded away" : "would be folded away"} · ${moved} reference${moved === 1 ? "" : "s"} ${APPLY ? "moved" : "would move"}`);

  // ── Same hours, different behaviour ───────────────────────────────────────
  const nearly: string[] = [];
  for (const [hours, all] of byHours) {
    // What survives the merge above — anything folded away is not a leftover.
    const group = all.filter((w) => !gone.has(String(w._id)));
    if (group.length < 2) continue;
    const prints = new Set(group.map((w) => fingerprint(w as unknown as Record<string, unknown>)));
    if (prints.size < 2) continue;
    nearly.push(hours);
    log(`\n  ${hours} — ${group.length} left standing, and they differ beyond the hours`);
    for (const w of group) {
      const u = await usage(w._id);
      log(`      "${w.name}"  grace=${w.graceMinutes ?? "unset"}  workDays=[${w.workDays ?? ""}]  halfDays=[${w.halfDays ?? ""}]  ${u.total} in use`);
    }
    log(`      Decide which is right before folding these together — a half day is`);
    log(`      somebody's Saturday, not a naming difference.`);
  }

  head("Done");
  if (!APPLY) log(`  Nothing was written. Re-run with --apply to merge.`);
  else log(`  ${(await WorkSchedule.countDocuments({ organization: org._id }))} schedules remain.`);
  if (nearly.length) log(`  ${nearly.length} group${nearly.length === 1 ? "" : "s"} left for you to decide on, above.`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
