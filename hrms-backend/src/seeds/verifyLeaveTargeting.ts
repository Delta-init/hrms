/**
 * How the new policy targeting resolves, against the real staff list.
 *
 * Read-only: it resolves policies in memory and writes nothing. The scenarios
 * below are synthetic policies held in a local array — no row is created.
 *
 *     bun src/seeds/verifyLeaveTargeting.ts
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { Organization } from "../models/Organization.js";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { WorkSchedule } from "../models/WorkSchedule.js";
import { accruedFor, type EffectivePolicy } from "../services/leavePolicyResolver.js";

const P = (o: Partial<EffectivePolicy>): EffectivePolicy => ({
  _id: o._id ?? "x", type: "annual", label: "Annual leave", days: 0, period: "year",
  paid: true, eligibleAfterMonths: 0, carryForwardLimit: 0,
  workSchedule: null, workMode: null, effectiveFrom: null, supersededDays: null, ...o,
});

/** The same precedence the resolver uses, exercised over synthetic policies. */
function resolve(all: EffectivePolicy[], scheduleId: string | null, workMode: "office" | "wfh" | null) {
  const rank = (p: EffectivePolicy) => (p.workMode ? 2 : p.workSchedule ? 1 : 0);
  let win: EffectivePolicy | null = null, run: EffectivePolicy | null = null;
  for (const p of all) {
    if (p.workSchedule && p.workSchedule !== scheduleId) continue;
    if (p.workMode && p.workMode !== workMode) continue;
    if (!win) { win = p; continue; }
    if (rank(p) > rank(win)) { run = win; win = p; }
    else if (!run || rank(p) > rank(run)) run = p;
  }
  return win ? { ...win, supersededDays: run?.days ?? null } : null;
}

async function main() {
  await connectDB();
  const org = (await Organization.findOne({ name: /Delta International/i }).select("_id").lean())!;
  const emps = await Employee.find({ organization: org._id, status: { $ne: "terminated" } })
    .select("name workMode user").lean();
  const users = await User.find({ organization: org._id }).select("_id workSchedule").lean();
  const ws = new Map(users.map((u) => [String(u._id), u.workSchedule ? String(u.workSchedule) : null]));
  const scheds = await WorkSchedule.find({ organization: org._id }).select("name").lean();
  const sName = new Map(scheds.map((s) => [String(s._id), s.name]));
  // The one that actually carries both kinds of staff — the case the old
  // schedule-only targeting could not express.
  const mixed = scheds.find((s) => /11:30am/i.test(String(s.name)))!;

  const orgWide = P({ _id: "org", days: 30 });
  const schedPol = P({ _id: "sched", days: 25, workSchedule: String(mixed._id) });
  const wfhPol = P({ _id: "wfh", days: 24, workMode: "wfh" });
  const officePol = P({ _id: "office", days: 28, workMode: "office" });

  console.log("━━━ REACH — how many people each policy actually governs\n");
  const sets: Array<[string, EffectivePolicy[]]> = [
    ["org-wide only (today)", [orgWide]],
    ["org-wide + schedule", [orgWide, schedPol]],
    ["org-wide + schedule + WFH", [orgWide, schedPol, wfhPol]],
    ["org-wide + schedule + WFH + office", [orgWide, schedPol, wfhPol, officePol]],
  ];
  for (const [label, all] of sets) {
    const tally: Record<string, number> = {};
    for (const e of emps) {
      const sched = e.user ? ws.get(String(e.user)) ?? null : null;
      const win = resolve(all, sched, (e.workMode as "office" | "wfh") ?? null);
      const k = win ? String(win._id) : "(none)";
      tally[k] = (tally[k] ?? 0) + 1;
    }
    console.log(`  ${label.padEnd(36)} ${JSON.stringify(tally)}`);
  }

  console.log(`\n━━━ THE MIXED SCHEDULE — "${mixed.name}"\n`);
  const all = [orgWide, schedPol, wfhPol, officePol];
  const onMixed = emps.filter((e) => e.user && ws.get(String(e.user)) === String(mixed._id));
  const byWin: Record<string, string[]> = {};
  for (const e of onMixed) {
    const win = resolve(all, String(mixed._id), (e.workMode as "office" | "wfh") ?? null)!;
    (byWin[`${win._id} (${win.days}d)`] ??= []).push(`${e.name} [${e.workMode}]`);
  }
  for (const [k, v] of Object.entries(byWin)) console.log(`  ${k}: ${v.length} — ${v.slice(0, 3).join(", ")}${v.length > 3 ? ", …" : ""}`);
  console.log("  → work mode beats the schedule, so office and remote staff on one shift diverge.");

  console.log("\n━━━ EFFECTIVE FROM — a cut cannot claw back a year already granted\n");
  const now = new Date();
  const midYear = new Date(Date.UTC(now.getUTCFullYear(), 8, 2)); // 2 September
  const cut = P({ days: 24, workMode: "wfh", effectiveFrom: midYear, supersededDays: 30 });
  const rise = P({ days: 36, workMode: "wfh", effectiveFrom: midYear, supersededDays: 30 });
  const old = P({ days: 24, workMode: "wfh", effectiveFrom: new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1)), supersededDays: 30 });
  const legacy = P({ days: 24, workMode: "wfh", effectiveFrom: null, supersededDays: 30 });
  const rows: Array<[string, EffectivePolicy, number]> = [
    ["cut 30→24 saved 2 Sep, this year", cut, 30],
    ["rise 30→36 saved 2 Sep, this year", rise, 36],
    ["cut 30→24 in force since last year", old, 24],
    ["policy with no effectiveFrom (existing rows)", legacy, 24],
  ];
  let ok = true;
  for (const [label, pol, want] of rows) {
    const got = accruedFor(pol, null, now);
    const pass = got === want;
    ok &&= pass;
    console.log(`  ${label.padEnd(46)} → ${String(got).padStart(2)}d  (expect ${want})  ${pass ? "✓" : "✗"}`);
  }
  console.log(`\n  ${ok ? "all correct" : "MISMATCH"}`);

  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
