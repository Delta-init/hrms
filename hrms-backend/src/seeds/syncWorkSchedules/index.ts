/**
 * Put every login's work schedule back in step with its employee record, and
 * re-judge the attendance that was scored against the wrong one.
 *
 * The schedule lives on two documents. HR edits it on the employee record;
 * attendance reads it from the login. `createLogin` copied it once when the
 * account was made and nothing carried a later change across, so an edit moved
 * one document and left the other behind. Where the login had never been given
 * one at all, attendance fell back to a hardcoded 09:00-18:00 Asia/Dubai.
 *
 * The result was people being marked late for arriving on time — one clock-in
 * two minutes before her shift was recorded as fifty-nine minutes late. Those
 * minutes feed the lateness penalty, and the penalty feeds payroll, so this is
 * not a cosmetic disagreement.
 *
 * Two passes, both dry by default:
 *   1. copy the employee record's schedule onto the login wherever they differ;
 *   2. recompute status and late minutes for attendance already recorded,
 *      using the same resolveShift/statusForClockIn the clock-in itself uses.
 *
 *   bun src/seeds/syncWorkSchedules/index.ts                 # show what would change
 *   bun src/seeds/syncWorkSchedules/index.ts --apply         # sync schedules
 *   bun src/seeds/syncWorkSchedules/index.ts --apply --attendance   # and re-judge attendance
 */
import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../../config/env.js";
import { Organization } from "../../models/Organization.js";
import { Employee } from "../../models/Employee.js";
import { User } from "../../models/User.js";
import { WorkSchedule } from "../../models/WorkSchedule.js";
import { Attendance } from "../../models/Attendance.js";
import { RosterAssignment } from "../../models/RosterAssignment.js";
import { DEFAULT_SCHEDULE, resolveShift, statusForClockIn, type ShiftSchedule } from "../../utils/schedule.js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ATTENDANCE = args.includes("--attendance");
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const ORG_NAME = arg("org") ?? "Delta International Management Development Training";
/**
 * Give a schedule to people who have none.
 *
 * Nothing in the system, and nothing in the GreytHR export, says what shift
 * these people work — `Curr.Shift` is blank for exactly them, so the gap came
 * over from the old system rather than being lost here. It cannot be inferred
 * either: the people who do have one are split across timezones with no
 * relation to their location. So it has to be stated, not guessed.
 *
 *   --assign="10:00am - 7:00pm"           every unassigned person
 *   --assign="Dubai" --where-location=dubai   only those in Dubai
 *   --from=shifts.xlsx                    per person, from a sheet of
 *                                         employee code + schedule name
 */
const ASSIGN = arg("assign");
const FROM = arg("from");
const WHERE_LOCATION = arg("where-location")?.toLowerCase();
const WHERE_DEPT = arg("where-dept")?.toLowerCase();
const WHERE_WORKMODE = arg("where-workmode")?.toLowerCase();
/**
 * Also move people who already have a schedule, when its timezone is not the
 * one being assigned.
 *
 * Work-from-home staff belong on Asia/Kolkata, and some are sitting on a Dubai
 * shift. Widening the search to them would ordinarily risk overwriting a shift
 * somebody chose on purpose, so the test is the timezone alone: anyone already
 * in the right zone keeps their own hours, whatever they are.
 */
const RETIMEZONE = args.includes("--fix-timezone");

const log = (m = "") => console.log(m);
const head = (t: string) => log(`\n── ${t} ${"─".repeat(Math.max(0, 58 - t.length))}`);

interface Sched { _id: unknown; name: string; timeZone: string; loginTime: string; logoutTime: string; graceMinutes?: number }

/** The shape resolveShift wants, from a schedule document or the fallback. */
function shiftOf(ws: Sched | undefined): { schedule: ShiftSchedule; label: string } {
  if (!ws) return { schedule: DEFAULT_SCHEDULE, label: `${DEFAULT_SCHEDULE.loginTime}–${DEFAULT_SCHEDULE.logoutTime} ${DEFAULT_SCHEDULE.timeZone} (fallback)` };
  return {
    schedule: { timeZone: ws.timeZone, loginTime: ws.loginTime, logoutTime: ws.logoutTime, graceMinutes: ws.graceMinutes ?? 15 },
    label: `${ws.loginTime}–${ws.logoutTime} ${ws.timeZone}`,
  };
}

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const org = await Organization.findOne({ name: ORG_NAME }).lean();
  if (!org) throw new Error(`No organisation named "${ORG_NAME}"`);

  log(`Organisation : ${org.name}`);
  log(`Mode         : ${APPLY ? "APPLY — changes are written" : "DRY RUN — nothing is written"}`);
  log(`Attendance   : ${ATTENDANCE ? "will be re-judged" : "left alone (--attendance to include it)"}`);

  const schedules = new Map<string, Sched>(
    (await WorkSchedule.find({ organization: org._id }).select("name timeZone loginTime logoutTime graceMinutes").lean() as unknown as Sched[])
      .map((w) => [String(w._id), w])
  );

  // ── 0. Assign, where somebody has none ────────────────────────────────────
  if (ASSIGN || FROM) {
    head("Giving a schedule to people who have none");
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
    const byName = new Map([...schedules.values()].map((w) => [norm(w.name), w]));

    /** code → schedule name, when a sheet is naming them one by one. */
    const fromSheet = new Map<string, string>();
    if (FROM) {
      const XLSX = (await import("xlsx")).default;
      const wb = XLSX.readFile(FROM);
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }) as Record<string, unknown>[];
      if (!rows.length) throw new Error(`${FROM} has no rows`);
      const cols = Object.keys(rows[0]);
      const codeCol = cols.find((c) => /^(employee\s*)?(code|number|no\.?|id)$/i.test(c.trim())) ?? cols[0];
      const schedCol = cols.find((c) => /shift|schedule/i.test(c)) ?? cols[1];
      log(`  reading ${FROM} — code column "${codeCol}", schedule column "${schedCol}"`);
      for (const r of rows) {
        const code = String(r[codeCol] ?? "").trim().toUpperCase();
        const name = String(r[schedCol] ?? "").trim();
        if (code && name) fromSheet.set(code, name);
      }
      log(`  ${fromSheet.size} people named in the sheet`);
    }

    let blanket: Sched | undefined;
    if (ASSIGN) {
      blanket = byName.get(norm(ASSIGN)) ?? [...schedules.values()].find((w) => String(w._id) === ASSIGN);
      if (!blanket) {
        log(`  No schedule named "${ASSIGN}". The org has:`);
        for (const w of schedules.values()) log(`      ${w.name}  (${w.loginTime}–${w.logoutTime} ${w.timeZone})`);
        throw new Error(`Unknown schedule "${ASSIGN}"`);
      }
      log(`  assigning: ${blanket.name}  ${blanket.loginTime}–${blanket.logoutTime} ${blanket.timeZone}`);
    }

    const scope: Record<string, unknown> = { organization: org._id, user: { $ne: null }, status: { $ne: "terminated" } };
    if (!RETIMEZONE) scope.workSchedule = null;
    const unassigned = await Employee.find(scope)
      .select("name employeeCode user location department workMode workSchedule")
      .sort({ employeeCode: 1 })
      .lean();

    let given = 0;
    const unnamed: string[] = [];
    for (const emp of unassigned) {
      if (WHERE_LOCATION && String(emp.location ?? "").toLowerCase() !== WHERE_LOCATION) continue;
      if (WHERE_DEPT && norm(String(emp.department ?? "")) !== norm(WHERE_DEPT)) continue;
      if (WHERE_WORKMODE && String(emp.workMode ?? "").toLowerCase() !== WHERE_WORKMODE) continue;
      let target = blanket;
      if (fromSheet.size) {
        const wanted = fromSheet.get(String(emp.employeeCode).toUpperCase());
        if (!wanted) { if (!blanket) { unnamed.push(`${emp.employeeCode} ${emp.name}`); continue; } }
        else {
          const found = byName.get(norm(wanted));
          if (!found) { unnamed.push(`${emp.employeeCode} ${emp.name} — sheet says "${wanted}", no such schedule`); continue; }
          target = found;
        }
      }
      if (!target) continue;
      const current = emp.workSchedule ? schedules.get(String(emp.workSchedule)) : undefined;
      // Already in the right zone: their hours are their own, leave them.
      if (current && current.timeZone === target.timeZone) continue;
      const was = current ? `${current.loginTime}–${current.logoutTime} ${current.timeZone}` : "none";
      log(`  ${String(emp.employeeCode).padEnd(6)} ${String(emp.name).slice(0, 30).padEnd(31)} ${was.padEnd(26)} → ${target.loginTime}–${target.logoutTime} ${target.timeZone}`);
      if (APPLY) {
        // Both documents, together — that is the whole point of this seed.
        await Employee.updateOne({ _id: emp._id }, { $set: { workSchedule: target._id } });
        await User.updateOne({ _id: emp.user }, { $set: { workSchedule: target._id } });
      }
      given++;
    }
    log(`\n  ${given} ${APPLY ? "given a schedule on both the employee record and the login" : "would be given a schedule"}`);
    if (unnamed.length) {
      log(`  ${unnamed.length} left without one:`);
      for (const u of unnamed.slice(0, 10)) log(`      ${u}`);
      if (unnamed.length > 10) log(`      … and ${unnamed.length - 10} more`);
    }
  }

  // ── 1. Schedules ──────────────────────────────────────────────────────────
  head("Logins whose schedule does not match their employee record");
  const employees = await Employee.find({ organization: org._id, user: { $ne: null } })
    .select("name employeeCode user workSchedule status")
    .sort({ employeeCode: 1 })
    .lean();
  const users = new Map(
    (await User.find({ organization: org._id }).select("workSchedule").lean() as unknown as { _id: unknown; workSchedule?: unknown }[])
      .map((u) => [String(u._id), u])
  );

  let synced = 0;
  const stillNone: string[] = [];
  for (const emp of employees) {
    const user = users.get(String(emp.user));
    if (!user) continue;
    const empId = emp.workSchedule ? String(emp.workSchedule) : null;
    const usrId = user.workSchedule ? String(user.workSchedule) : null;
    if (empId === usrId) {
      if (!empId && emp.status !== "terminated") stillNone.push(`${emp.employeeCode} ${emp.name}`);
      continue;
    }
    const from = usrId ? shiftOf(schedules.get(usrId)).label : "none → 09:00 fallback";
    const to = empId ? shiftOf(schedules.get(empId)).label : "none";
    log(`  ${String(emp.employeeCode).padEnd(6)} ${String(emp.name).slice(0, 30).padEnd(31)} ${from}  →  ${to}`);
    if (APPLY) await User.updateOne({ _id: emp.user }, { $set: { workSchedule: emp.workSchedule ?? null } });
    synced++;
  }
  log(`\n  ${synced} login${synced === 1 ? "" : "s"} ${APPLY ? "brought into step" : "would be brought into step"}`);
  if (stillNone.length) {
    log(`\n  ${stillNone.length} still have no schedule on either document, so attendance keeps`);
    log(`  judging them against ${DEFAULT_SCHEDULE.loginTime}–${DEFAULT_SCHEDULE.logoutTime} ${DEFAULT_SCHEDULE.timeZone}. Assign one to fix them:`);
    for (const s of stillNone.slice(0, 8)) log(`      ${s}`);
    if (stillNone.length > 8) log(`      … and ${stillNone.length - 8} more`);
  }

  // ── 2. Attendance ─────────────────────────────────────────────────────────
  if (!ATTENDANCE) {
    head("Attendance");
    log(`  Not touched. Re-run with --attendance to re-judge records already recorded.`);
    await mongoose.disconnect();
    return;
  }

  head("Attendance already recorded, re-judged against the corrected schedule");
  // Judge against the schedule the sync above settles on — the employee
  // record's — rather than re-reading the login. A dry run writes nothing, so
  // reading the login back would preview the old answer and report almost
  // nothing to fix, which is precisely the reassurance this must not give.
  const intended = new Map<string, unknown>();
  for (const emp of employees) {
    if (emp.user) intended.set(String(emp.user), emp.workSchedule ?? null);
  }
  const rosters = await RosterAssignment.find({ organization: org._id }).select("user").lean();
  const rosterUsers = new Set(rosters.map((r) => String(r.user)));

  const records = await Attendance.find({ organization: org._id }).sort({ date: 1 });
  const nameOf = new Map(employees.map((e) => [String(e.user), `${e.employeeCode} ${e.name}`]));
  // Only a punch-derived status can be re-derived from a punch. Anything an
  // admin set deliberately — leave, absence, a holiday — is left as it stands.
  const derived = new Set(["present", "late", "half_day"]);
  let changed = 0, skipped = 0;

  for (const att of records) {
    const who = nameOf.get(String(att.user)) ?? String(att.user);
    if (!att.checkIn) { skipped++; continue; }
    if (!derived.has(String(att.status))) {
      log(`  ${String(who).slice(0, 30).padEnd(31)} ${String(att.date).slice(4, 15)}  left alone — status "${att.status}" was set by hand`);
      skipped++;
      continue;
    }
    if (rosterUsers.has(String(att.user))) {
      log(`  ${String(who).slice(0, 30).padEnd(31)} ${String(att.date).slice(4, 15)}  left alone — a roster assignment governs this person`);
      skipped++;
      continue;
    }

    const wsId = intended.get(String(att.user));
    const { schedule, label } = shiftOf(wsId ? schedules.get(String(wsId)) : undefined);
    const shift = resolveShift(schedule, att.checkIn);
    const status = statusForClockIn(att.checkIn, shift);
    const lateMinutes = status === "present" ? 0 : Math.max(0, Math.round((att.checkIn.getTime() - shift.shiftStart.getTime()) / 60000));

    const wasStatus = String(att.status);
    const wasLate = att.lateMinutes ?? 0;
    if (wasStatus === status && wasLate === lateMinutes && att.timeZone === schedule.timeZone) continue;

    const at = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: schedule.timeZone, hour12: false }).format(att.checkIn);
    log(`  ${String(who).slice(0, 30).padEnd(31)} ${String(att.date).slice(4, 15)}  in ${at} vs ${label}`);
    log(`      ${wasStatus} / ${wasLate} min  →  ${status} / ${lateMinutes} min`);

    if (APPLY) {
      att.status = status as typeof att.status;
      att.lateMinutes = lateMinutes;
      att.timeZone = schedule.timeZone;
      // The day a punch belongs to is the local day of the schedule it is
      // judged by, so a timezone correction can move it. Only where the slot
      // is free — two records on one day for one person is worse than a
      // record filed under the old day.
      const bucket = shift.dateMidnightUtc;
      if (att.date.getTime() !== bucket.getTime()) {
        const clash = await Attendance.findOne({ user: att.user, date: bucket, _id: { $ne: att._id } });
        if (clash) {
          log(`      date stays ${String(att.date).slice(4, 15)} — ${String(bucket).slice(4, 15)} already has a record`);
        } else {
          log(`      date ${String(att.date).slice(4, 15)} → ${String(bucket).slice(4, 15)} (local day under the corrected zone)`);
          att.date = bucket;
        }
      }
      await att.save();
    }
    changed++;
  }

  log(`\n  ${changed} record${changed === 1 ? "" : "s"} ${APPLY ? "re-judged" : "would be re-judged"} · ${skipped} left alone`);

  head("Done");
  if (!APPLY) log(`  Nothing was written. Re-run with --apply to make these changes.`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
