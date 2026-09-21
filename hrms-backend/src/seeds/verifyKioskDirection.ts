import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Organization } from "../models/Organization.js";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { Role } from "../models/Role.js";
import { WorkSchedule } from "../models/WorkSchedule.js";
import { Attendance } from "../models/Attendance.js";
import { FacePunchService } from "../services/facePunchService.js";
import { runWithOrg } from "../utils/orgContext.js";
import { zonedTimeToUtc, todayInTz } from "../utils/schedule.js";
import "../models/Department.js";

/**
 * Which session the kiosk picks, and therefore whether a tap is a check-in or
 * a check-out, across ten arrangements of a person's recent days.
 *
 * The regression it exists for: anyone who forgets to clock out keeps a day
 * that stays open for good, because closeStaleDays marks it half a day but
 * never fills in a checkOut. With two open days in the window and an unsorted
 * lookup, the kiosk picked yesterday's, found that day had ended, called the
 * tap a check-in and refused it as "you have already clocked in today" — while
 * clockOut, which does sort, would have closed today's quite happily. Nine
 * people were stuck behind it. Cases 4 and 7 print what the unsorted lookup
 * would have picked, so the fix cannot silently regress.
 *
 * Builds and destroys its own organisation, so it touches nothing real. It
 * needs a live database, which is why it is a seed rather than a `bun test`
 * file — `bun test` must never write to production.
 *
 *     bun src/seeds/verifyKioskDirection.ts
 */

const TZ = "Asia/Dubai";
const CODE = "TMPKSK";
const OPEN = null;

function withOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  return new Promise((res, rej) => runWithOrg({ orgId, isSuperAdmin: false }, () => { fn().then(res, rej); }));
}

async function cleanup(orgId: unknown) {
  await Promise.all([
    Attendance.deleteMany({ organization: orgId }), Employee.deleteMany({ organization: orgId }),
    User.deleteMany({ organization: orgId }), Role.deleteMany({ organization: orgId }),
    WorkSchedule.deleteMany({ organization: orgId }),
  ]);
  await Organization.deleteOne({ _id: orgId });
}

/** Local calendar day, `offset` days from today, as the code itself anchors it. */
function dayStr(offset: number, now: Date): string {
  const base = new Date(zonedTimeToUtc(todayInTz(TZ, now), "00:00", TZ).getTime() + offset * 86_400_000);
  return todayInTz(TZ, new Date(base.getTime() + 12 * 3600_000));
}

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  for (const s of await Organization.find({ code: CODE }).select("_id").lean()) await cleanup(s._id);

  const now = new Date();
  const org = await Organization.create({ name: "TMP Kiosk Scenarios", code: CODE, status: "active" });
  const orgId = String(org._id);
  const role = await Role.create({ roleName: "TmpK", organization: org._id, permissions: {} });
  const ws = await WorkSchedule.create({
    organization: org._id, name: "9-6 Dubai", timeZone: TZ,
    loginTime: "09:00", logoutTime: "18:00", graceMinutes: 10, mode: "fixed",
  });

  let n = 0;
  const mk = async (label: string) => {
    n += 1;
    const u = await User.create({
      name: label, email: `k${n}@tmpksk.test`, password: "Passw0rd!123",
      organization: org._id, role: role._id, status: "active", workSchedule: ws._id,
    });
    const e = await Employee.create({
      name: label, employeeCode: `K${String(n).padStart(3, "0")}`, organization: org._id,
      user: u._id, status: "active", workSchedule: ws._id,
    });
    return { user: String(u._id), emp: e._id };
  };

  /** A day's record. `inAt`/`outAt` are hours into that local day. */
  const punch = async (userId: string, offset: number, inHour: number, outHour: number | null) => {
    const d = dayStr(offset, now);
    const date = zonedTimeToUtc(d, "00:00", TZ);
    let checkIn = zonedTimeToUtc(d, `${String(inHour).padStart(2, "0")}:00`, TZ);
    // Today's check-in must already be in the past whatever time this runs.
    if (offset === 0 && checkIn.getTime() >= now.getTime()) checkIn = new Date(Math.max(date.getTime() + 60_000, now.getTime() - 60_000));
    const checkOut = outHour === null ? null : zonedTimeToUtc(d, `${String(outHour).padStart(2, "0")}:00`, TZ);
    await Attendance.create({
      organization: org._id, user: userId, date, localDay: d, timeZone: TZ,
      checkIn, checkOut, status: "present",
      sessions: [{ checkIn, checkOut }],
    });
  };

  interface Case { name: string; setup: (u: string) => Promise<void>; expect: "in" | "out"; expectDay?: number }
  const cases: Case[] = [
    { name: "1. Never punched at all", setup: async () => {}, expect: "in" },
    { name: "2. Checked in today, still open", setup: (u) => punch(u, 0, 9, OPEN), expect: "out", expectDay: 0 },
    { name: "3. Today already closed", setup: (u) => punch(u, 0, 9, 18), expect: "in" },
    { name: "4. THE BUG — yesterday open AND today open", setup: async (u) => { await punch(u, -1, 9, OPEN); await punch(u, 0, 9, OPEN); }, expect: "out", expectDay: 0 },
    { name: "5. Only yesterday left open, nothing today", setup: (u) => punch(u, -1, 9, OPEN), expect: "in" },
    { name: "6. Two stale days open, nothing today", setup: async (u) => { await punch(u, -2, 9, OPEN); await punch(u, -1, 9, OPEN); }, expect: "in" },
    { name: "7. Three days open incl. today", setup: async (u) => { await punch(u, -2, 9, OPEN); await punch(u, -1, 9, OPEN); await punch(u, 0, 9, OPEN); }, expect: "out", expectDay: 0 },
    { name: "8. Open session older than the 2-day window", setup: (u) => punch(u, -5, 9, OPEN), expect: "in" },
    { name: "9. Yesterday closed, today open", setup: async (u) => { await punch(u, -1, 9, 18); await punch(u, 0, 9, OPEN); }, expect: "out", expectDay: 0 },
    { name: "10. Yesterday open, today closed", setup: async (u) => { await punch(u, -1, 9, OPEN); await punch(u, 0, 9, 18); }, expect: "in" },
  ];

  const svc = new FacePunchService() as unknown as { openSession(id: string): Promise<{ checkIn?: Date | null } | null> };
  let pass = 0, fail = 0;

  console.log(`Kiosk direction — 10 scenarios (now ${now.toISOString()}, tz ${TZ})\n`);
  await withOrg(orgId, async () => {
    for (const c of cases) {
      const who = await mk(c.name);
      await c.setup(who.user);

      const open = await svc.openSession(who.user);
      const got: "in" | "out" = open ? "out" : "in";

      // What the unsorted lookup would have picked, for the regression cases.
      const cutoff = new Date(Date.now() - 2 * 86_400_000);
      const q = { user: who.user, checkIn: { $ne: null }, checkOut: null, date: { $gte: cutoff } };
      const unsorted = await Attendance.findOne(q).select("localDay").lean<{ localDay?: string } | null>();
      const sorted = await Attendance.findOne(q).sort({ date: -1 }).select("localDay").lean<{ localDay?: string } | null>();

      let ok = got === c.expect;
      let dayNote = "";
      if (ok && c.expectDay !== undefined && open?.checkIn) {
        const wantDay = dayStr(c.expectDay, now);
        const gotDay = todayInTz(TZ, new Date(open.checkIn));
        ok = gotDay === wantDay;
        dayNote = ` picked ${gotDay}${ok ? "" : ` (wanted ${wantDay})`}`;
      }
      const drift = unsorted && sorted && unsorted.localDay !== sorted.localDay ? `  [unsorted would pick ${unsorted.localDay}, sorted picks ${sorted.localDay}]` : "";
      console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(46)} expected ${c.expect.padEnd(3)} got ${got}${dayNote}${drift}`);
      ok ? pass++ : fail++;
    }
  });

  console.log(`\n${pass} passed, ${fail} failed.`);
  await cleanup(org._id);
  console.log("disposable org cleaned up.");
  await mongoose.disconnect();
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
