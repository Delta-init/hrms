/**
 * Checks attendanceDay (GET /integrations/directory/attendance-day) on a scratch database: somebody's shift and a
 * day's clock-ins and clock-outs, as the sales CRMs' Activity and team pages ask for them. Refuses anything but a
 * local scratch database.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hrms-attendance-day-scratch bun src/scripts/attendanceDayCheck.ts
 */
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[\w-]*scratch[\w-]*$/.test(uri)) {
  console.error(`Refusing: needs a local scratch database, got ${uri}`);
  process.exit(1);
}
// The route's module checks the server's settings when it loads: throwaway ones, for this check only.
Object.assign(process.env, {
  JWT_SECRET: "attendance-day-check-throwaway-secret-0001", JWT_REFRESH_SECRET: "attendance-day-check-throwaway-refresh-01",
  SUPER_ADMIN_EMAIL: "check@e2e.test", SUPER_ADMIN_PASSWORD: "attendance-day-check", NODE_ENV: "test",
});
const { attendanceDay } = await import("../services/directoryService.js");
const { readAttendanceDayQuery } = await import("../utils/attendanceDayQuery.js");

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail: unknown = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}${ok ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
};

await mongoose.connect(uri);
const db = mongoose.connection.db!;
for (const c of ["employees", "users", "attendances", "leaverequests", "workschedules", "rosterassignments"]) await db.collection(c).deleteMany({});

const H = 3_600_000, M = 60_000;
const dubaiDay = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
const TODAY = dubaiDay(Date.now());
const YESTERDAY = dubaiDay(Date.now() - 24 * H);
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00.000+04:00`);
const id = () => new mongoose.Types.ObjectId();

const salesShift = id();
await db.collection("workschedules").insertOne({ _id: salesShift, name: "Sales floor", timeZone: "Asia/Dubai", loginTime: "10:00", logoutTime: "19:00", workDays: [1, 2, 3, 4, 5, 6], halfDays: [], mode: "fixed" });

const people = {
  twoSessions: { user: id(), email: "two@e2e.test", schedule: salesShift },
  closed: { user: id(), email: "closed@e2e.test", schedule: salesShift },
  oldFormat: { user: id(), email: "old@e2e.test", schedule: null },
  onLeave: { user: id(), email: "leave@e2e.test", schedule: salesShift },
  wfh: { user: id(), email: "wfh@e2e.test", schedule: salesShift },
  gone: { user: id(), email: "gone@e2e.test", schedule: salesShift },
  yesterdayOnly: { user: id(), email: "yday@e2e.test", schedule: salesShift },
};
await db.collection("employees").insertMany(Object.entries(people).map(([k, p]) => ({
  _id: id(), user: p.user, email: p.email, name: k, employeeId: `E-${k}`, status: k === "gone" ? "resigned" : "active",
  ...(p.schedule ? { workSchedule: p.schedule } : {}),
})));
// Their logins, carrying the schedule as the HRMS mirrors it there (employeeService.mirrorScheduleToLogin) — the copy
// clock-in judges a day by.
await db.collection("users").insertMany(Object.entries(people).map(([k, p]) => ({ _id: p.user, email: p.email, name: k, workSchedule: p.schedule ?? null })));

const punch = { ip: "203.0.113.9", latitude: 25.2, longitude: 55.3, city: "Dubai", addressLabel: "Somewhere 1", deviceLabel: "Front desk" };
const record = (user: mongoose.Types.ObjectId, day: string, extra: Record<string, unknown>) => ({
  user, date: new Date(`${day}T00:00:00.000+04:00`), localDay: day, timeZone: "Asia/Dubai", status: "present", workedMinutes: 0, lateMinutes: 0, ...extra,
});
await db.collection("attendances").insertMany([
  record(people.twoSessions.user, TODAY, {
    checkIn: at(TODAY, "09:58"), checkOut: null, status: "present", workedMinutes: 182,
    sessions: [
      { checkIn: at(TODAY, "13:30"), checkOut: null, checkInSource: punch },
      { checkIn: at(TODAY, "09:58"), checkOut: at(TODAY, "13:00"), checkInSource: punch, checkOutSource: punch },
    ],
  }),
  record(people.closed.user, TODAY, {
    checkIn: at(TODAY, "10:20"), checkOut: at(TODAY, "18:00"), status: "late", workedMinutes: 460, lateMinutes: 20,
    sessions: [{ checkIn: at(TODAY, "10:20"), checkOut: at(TODAY, "18:00"), checkInSource: punch, checkOutSource: punch }],
  }),
  record(people.oldFormat.user, TODAY, { checkIn: at(TODAY, "09:05"), checkOut: at(TODAY, "17:55"), workedMinutes: 530, sessions: [] }),
  record(people.wfh.user, TODAY, { checkIn: at(TODAY, "10:01"), checkOut: null, status: "wfh", sessions: [{ checkIn: at(TODAY, "10:01"), checkOut: null }] }),
  record(people.yesterdayOnly.user, YESTERDAY, { checkIn: at(YESTERDAY, "10:00"), checkOut: at(YESTERDAY, "19:00"), workedMinutes: 540, sessions: [{ checkIn: at(YESTERDAY, "10:00"), checkOut: at(YESTERDAY, "19:00") }] }),
  record(people.gone.user, TODAY, { checkIn: at(TODAY, "10:00"), checkOut: null, sessions: [{ checkIn: at(TODAY, "10:00"), checkOut: null }] }),
]);
await db.collection("leaverequests").insertMany([
  { user: people.onLeave.user, type: "annual", status: "approved", halfDay: false, timeZone: "Asia/Dubai", startDate: at(TODAY, "00:00"), endDate: at(TODAY, "23:59") },
  { user: people.wfh.user, type: "wfh", status: "approved", halfDay: false, timeZone: "Asia/Dubai", startDate: at(TODAY, "00:00"), endDate: at(TODAY, "23:59") },
]);

console.log(`\nCase 1 — a day's record and shift (${TODAY})`);
const rows = await attendanceDay({ emails: [...Object.values(people).map((p) => p.email), "nobody@e2e.test"], day: TODAY });
const of = (email: string) => rows.find((r) => r.email === email);
const two = of("two@e2e.test");
check("the shift comes from their schedule: 10:00–19:00, Dubai, Mon–Sat, assigned", two?.schedule.loginTime === "10:00" && two.schedule.logoutTime === "19:00" && two.schedule.timeZone === "Asia/Dubai" && two.schedule.assigned === true && two.schedule.workDays.join() === "1,2,3,4,5,6", two?.schedule);
check("two sessions, in order: 09:58–13:00 and 13:30 still open", two?.attendance?.sessions.length === 2 && two.attendance.sessions[0]!.in === at(TODAY, "09:58").toISOString() && two.attendance.sessions[0]!.out === at(TODAY, "13:00").toISOString() && two.attendance.sessions[1]!.out === null, two?.attendance?.sessions);
check("…first in 09:58, no last out while still clocked in, 182 minutes worked", two?.attendance?.firstIn === at(TODAY, "09:58").toISOString() && two.attendance.lastOut === null && two.attendance.workedMinutes === 182, two?.attendance);
check("…and clocked in now", two?.now === "in", two?.now);
const closed = of("closed@e2e.test");
check("a closed day: in 10:20, out 18:00, late by 20, status late, out now", closed?.attendance?.firstIn === at(TODAY, "10:20").toISOString() && closed.attendance.lastOut === at(TODAY, "18:00").toISOString() && closed.attendance.lateMinutes === 20 && closed.attendance.status === "late" && closed.now === "out", closed);
const old = of("old@e2e.test");
check("a record with no sessions list: its clock-in and clock-out become the one session", old?.attendance?.sessions.length === 1 && old.attendance.sessions[0]!.in === at(TODAY, "09:05").toISOString() && old.attendance.lastOut === at(TODAY, "17:55").toISOString(), old?.attendance);
check("no schedule assigned: the HRMS's default, said so", old?.schedule.assigned === false && !!old.schedule.loginTime, old?.schedule);
const leave = of("leave@e2e.test");
check("on approved leave, no record: leave annual, no attendance, on leave now", leave?.leave?.type === "annual" && leave.attendance === null && leave.now === "leave" && leave.wfh === false, leave);
const wfh = of("wfh@e2e.test");
check("working from home is not leave: wfh, no leave, clocked in", wfh?.wfh === true && wfh.leave === null && wfh.now === "in" && wfh.attendance?.status === "wfh", wfh);
check("a leaver is left out, and an unknown email gives nothing", !of("gone@e2e.test") && !of("nobody@e2e.test") && rows.length === 6, rows.map((r) => r.email));
check("yesterday's record isn't today's", of("yday@e2e.test")?.attendance === null, of("yday@e2e.test")?.attendance);
const raw = JSON.stringify(rows);
check("where and how they punched is not given out (no IP, place, device)", !/203\.0\.113|latitude|longitude|Somewhere|Front desk|checkInSource|"ip"/.test(raw), raw.slice(0, 160));
check("today's working day is said so (or not, on a Sunday)", rows.every((r) => r.workDay === r.schedule.workDays.includes(new Date(`${TODAY}T12:00:00Z`).getUTCDay())));

console.log(`\nCase 2 — another day`);
const yday = await attendanceDay({ emails: ["yday@e2e.test", "two@e2e.test"], day: YESTERDAY });
const y = yday.find((r) => r.email === "yday@e2e.test");
check("yesterday: in 10:00, out 19:00, 540 minutes", y?.attendance?.firstIn === at(YESTERDAY, "10:00").toISOString() && y.attendance.lastOut === at(YESTERDAY, "19:00").toISOString() && y.attendance.workedMinutes === 540, y);
check("…and no \"now\" for a day that isn't today", yday.every((r) => r.now === null), yday.map((r) => r.now));
const sunday = (() => { const d = new Date(`${TODAY}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); })();
const sun = await attendanceDay({ emails: ["two@e2e.test"], day: sunday });
check(`a Sunday (${sunday}) is not a working day on a Mon–Sat shift`, sun[0]?.workDay === false, sun[0]?.workDay);

console.log(`\nCase 3 — what the route takes`);
const bad = (q: Record<string, unknown>) => { const r = readAttendanceDayQuery(q); return r.ok ? "" : r.message; };
check("no emails → refused", bad({ day: TODAY }) === "emails is required", bad({ day: TODAY }));
check("no day → refused", bad({ emails: "two@e2e.test" }) === "day is a date (YYYY-MM-DD)", bad({ emails: "two@e2e.test" }));
check("a day that isn't one (2026-02-30) → refused", bad({ emails: "two@e2e.test", day: "2026-02-30" }) === "day is a date (YYYY-MM-DD)", bad({ emails: "two@e2e.test", day: "2026-02-30" }));
check("a day weeks ahead → refused", bad({ emails: "two@e2e.test", day: "2099-01-01" }) === "That day hasn't come yet");
check("201 emails → refused", bad({ emails: Array.from({ length: 201 }, (_, i) => `p${i}@e2e.test`).join(","), day: TODAY }) === "At most 200 emails at a time");
const good = readAttendanceDayQuery({ emails: "Two@E2E.test, two@e2e.test,not-an-email", day: TODAY });
check("emails tidied (lower case, once, the bad ones dropped) and the day kept", good.ok && good.emails.join() === "two@e2e.test" && good.day === TODAY, good);
check("organizationId that isn't an id → refused, not a database error", bad({ emails: "two@e2e.test", day: TODAY, organizationId: "not-an-id" }) === "organizationId is not an organization's id");
check("…nor the parameter twice", bad({ emails: "two@e2e.test", day: TODAY, organizationId: ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"] }) === "organizationId is not an organization's id");
const withOrg = readAttendanceDayQuery({ emails: "two@e2e.test", day: TODAY, organizationId: " 507f1f77bcf86cd799439011 " });
const blankOrg = readAttendanceDayQuery({ emails: "two@e2e.test", day: TODAY, organizationId: "" });
check("a real id is kept (trimmed), a blank one ignored", withOrg.ok && withOrg.organizationId === "507f1f77bcf86cd799439011" && blankOrg.ok && !("organizationId" in blankOrg), [withOrg, blankOrg]);
// The route itself: GET /integrations/directory/attendance-day → listAttendanceDay (readAttendanceDayQuery → attendanceDay).

console.log(`\nCase 4 — each row is that person's own, and the shift is the one the day was judged by`);
const orgA = id(), orgB = id();
const night = id(), evening = id(), sundays = id();
await db.collection("workschedules").insertMany([
  { _id: night, name: "Night", timeZone: "Asia/Dubai", loginTime: "20:00", logoutTime: "05:00", workDays: [1, 2, 3, 4, 5, 6], halfDays: [], mode: "fixed" },
  { _id: evening, name: "Evening", timeZone: "Asia/Dubai", loginTime: "14:00", logoutTime: "23:00", workDays: [1, 2, 3, 4, 5, 6], halfDays: [], mode: "fixed" },
  { _id: sundays, name: "Sunday roster", timeZone: "Asia/Dubai", loginTime: "10:00", logoutTime: "19:00", workDays: [0], halfDays: [], mode: "fixed" },
]);
const more = {
  dupA: { user: id(), email: "dup@e2e.test", org: orgA, schedule: salesShift },
  dupB: { user: id(), email: "dup@e2e.test", org: orgB, schedule: night },
  twiceLogin: { user: id(), email: "twice@e2e.test", org: orgA, schedule: salesShift },
  twiceBare: { user: null, email: "twice@e2e.test", org: orgA, schedule: null },
  rostered: { user: id(), email: "roster@e2e.test", org: orgA, schedule: salesShift },
  sunday: { user: id(), email: "sunday@e2e.test", org: orgA, schedule: salesShift },
  legacy: { user: id(), email: "legacy@e2e.test", org: orgA, schedule: salesShift },
  topLevel: { user: id(), email: "toplevel@e2e.test", org: orgA, schedule: salesShift },
  twoZones: { user: id(), email: "twozones@e2e.test", org: orgA, schedule: salesShift },
  wfhStatus: { user: id(), email: "wfhstatus@e2e.test", org: orgA, schedule: salesShift },
};
await db.collection("employees").insertMany(Object.entries(more).map(([k, p]) => ({
  _id: id(), email: p.email, name: k, employeeId: `E-${k}`, status: "active", organization: p.org,
  ...(p.user ? { user: p.user } : {}), ...(p.schedule ? { workSchedule: p.schedule } : {}),
})));
// A login's email is its own (unique): two employee records sharing an address still have two logins.
await db.collection("users").insertMany(Object.entries(more).flatMap(([k, p]) => (p.user ? [{ _id: p.user, email: `${k.toLowerCase()}@login.e2e.test`, name: k, workSchedule: p.schedule }] : [])));
await db.collection("rosterassignments").insertMany([
  { organization: orgA, user: more.rostered.user, workSchedule: evening, effectiveFrom: new Date(Date.parse(`${TODAY}T00:00:00Z`) - 3 * 24 * H), effectiveTo: new Date(Date.parse(`${TODAY}T00:00:00Z`) + 3 * 24 * H) },
  { organization: orgA, user: more.sunday.user, workSchedule: sundays, effectiveFrom: new Date(Date.parse(`${sunday}T00:00:00Z`) - 24 * H), effectiveTo: new Date(Date.parse(`${sunday}T00:00:00Z`) + 24 * H) },
]);
await db.collection("attendances").insertMany([
  record(more.dupA.user, TODAY, { checkIn: at(TODAY, "10:02"), checkOut: null, sessions: [{ checkIn: at(TODAY, "10:02"), checkOut: null }] }),
  record(more.twiceLogin.user, TODAY, { checkIn: at(TODAY, "09:59"), checkOut: null, sessions: [{ checkIn: at(TODAY, "09:59"), checkOut: null }] }),
  record(more.rostered.user, TODAY, { checkIn: at(TODAY, "14:05"), checkOut: null, lateMinutes: 0, sessions: [{ checkIn: at(TODAY, "14:05"), checkOut: null }] }),
  // An old record with two sessions: the top-level clock-out is the last closed one, though a later one is open.
  record(more.legacy.user, TODAY, { checkIn: at(TODAY, "09:00"), checkOut: at(TODAY, "11:00"), sessions: [{ checkIn: at(TODAY, "09:00"), checkOut: at(TODAY, "11:00") }, { checkIn: at(TODAY, "11:30"), checkOut: null }] }),
  // An old record whose top-level clock-in is its second session's.
  record(more.topLevel.user, TODAY, { checkIn: at(TODAY, "13:30"), checkOut: at(TODAY, "17:00"), sessions: [{ checkIn: at(TODAY, "09:58"), checkOut: at(TODAY, "12:00") }, { checkIn: at(TODAY, "13:30"), checkOut: at(TODAY, "17:00") }] }),
  // A time zone changed mid-day: two records on one day.
  record(more.twoZones.user, TODAY, { checkIn: at(TODAY, "09:00"), checkOut: at(TODAY, "10:30"), workedMinutes: 90, lateMinutes: 0, sessions: [{ checkIn: at(TODAY, "09:00"), checkOut: at(TODAY, "10:30") }] }),
  { ...record(more.twoZones.user, TODAY, { checkIn: at(TODAY, "11:00"), checkOut: null, workedMinutes: 30, lateMinutes: 45, sessions: [{ checkIn: at(TODAY, "11:00"), checkOut: null }] }), timeZone: "Asia/Kolkata", date: new Date(`${TODAY}T00:00:00.000+05:30`) },
  record(more.wfhStatus.user, TODAY, { checkIn: at(TODAY, "10:00"), checkOut: null, status: "wfh", sessions: [{ checkIn: at(TODAY, "10:00"), checkOut: null }] }),
]);
await db.collection("leaverequests").insertOne({ user: more.dupB.user, type: "annual", status: "approved", halfDay: false, timeZone: "Asia/Dubai", startDate: at(TODAY, "00:00"), endDate: at(TODAY, "23:59") });

const dup = await attendanceDay({ emails: ["dup@e2e.test"], day: TODAY });
const dupIn = dup.find((r) => r.attendance?.sessions.length), dupOff = dup.find((r) => !r.attendance);
check("one address, two organizations: two rows, each with its own shift, leave and now", dup.length === 2
  && dupIn?.schedule.name === "Sales floor" && dupIn.leave === null && dupIn.now === "in"
  && dupOff?.schedule.name === "Night" && dupOff.leave?.type === "annual" && dupOff.now === "leave", dup.map((r) => [r.schedule.name, r.leave, r.now]));
const dupOrg = await attendanceDay({ emails: ["dup@e2e.test"], day: TODAY, organizationId: String(orgA) });
check("…and the one organization's alone when it's named", dupOrg.length === 1 && dupOrg[0]!.schedule.name === "Sales floor" && dupOrg[0]!.now === "in", dupOrg.map((r) => [r.schedule.name, r.now]));
const twice = await attendanceDay({ emails: ["twice@e2e.test"], day: TODAY, organizationId: String(orgA) });
const twiceLogin = twice.find((r) => r.attendance), twiceBare = twice.find((r) => !r.attendance);
check("one address imported twice: the record with the login keeps its shift; the bare one has the default", twice.length === 2
  && twiceLogin?.schedule.name === "Sales floor" && twiceLogin.schedule.assigned && twiceLogin.now === "in"
  && twiceBare?.schedule.assigned === false && twiceBare.now === "out", twice.map((r) => [r.schedule.name, r.schedule.assigned, r.now]));
const rostered = (await attendanceDay({ emails: ["roster@e2e.test"], day: TODAY }))[0];
check("rostered onto Evening 14:00–23:00 for the week: that is the shift, not their usual 10:00–19:00", rostered?.schedule.name === "Evening" && rostered.schedule.loginTime === "14:00" && rostered.attendance?.lateMinutes === 0, rostered?.schedule);
const sundayRow = (await attendanceDay({ emails: ["sunday@e2e.test", "two@e2e.test"], day: sunday }));
check(`rostered to work Sunday ${sunday}: a working day for them, still not for the Mon–Sat shift`, sundayRow.find((r) => r.email === "sunday@e2e.test")?.workDay === true && sundayRow.find((r) => r.email === "two@e2e.test")?.workDay === false, sundayRow.map((r) => [r.email, r.schedule.name, r.workDay]));
const day4 = await attendanceDay({ emails: ["legacy@e2e.test", "toplevel@e2e.test", "twozones@e2e.test", "wfhstatus@e2e.test"], day: TODAY });
const of4 = (email: string) => day4.find((r) => r.email === email);
const legacy = of4("legacy@e2e.test");
check("an old record with a later session open: still in — no last out, clocked in now", legacy?.attendance?.lastOut === null && legacy.now === "in" && legacy.attendance.sessions.length === 2, legacy);
const topLevel = of4("toplevel@e2e.test");
check("first in and last out come from the sessions: 09:58 and 17:00, not the record's 13:30", topLevel?.attendance?.firstIn === at(TODAY, "09:58").toISOString() && topLevel.attendance.lastOut === at(TODAY, "17:00").toISOString(), topLevel?.attendance);
const twoZones = of4("twozones@e2e.test");
check("two records on one day are read as one: both sessions, 120 minutes, late as the day began (0), in now", twoZones?.attendance?.sessions.length === 2 && twoZones.attendance.workedMinutes === 120 && twoZones.attendance.lateMinutes === 0 && twoZones.attendance.lastOut === null && twoZones.now === "in", twoZones?.attendance);
check("a day recorded as working from home says so, with no leave request", of4("wfhstatus@e2e.test")?.wfh === true && of4("wfhstatus@e2e.test")?.leave === null, of4("wfhstatus@e2e.test"));

console.log(`\nCase 5 — a roster's last day, overlapping records, a forgotten clock-out, and records nobody can read`);
const five = {
  lastDay: { user: id(), email: "lastday@e2e.test" },
  overlap: { user: id(), email: "overlap@e2e.test" },
  overlapOpen: { user: id(), email: "overlapopen@e2e.test" },
  forgot: { user: id(), email: "forgot@e2e.test" },
  badZone: { user: id(), email: "badzone@e2e.test" },
  badDate: { user: id(), email: "baddate@e2e.test" },
};
await db.collection("employees").insertMany([
  ...Object.entries(five).map(([k, p]) => ({ _id: id(), email: p.email, name: k, employeeId: `E5-${k}`, status: "active", user: p.user, workSchedule: salesShift })),
  // Raw-imported junk: a login that isn't an id, a schedule that isn't one.
  { _id: id(), email: "junk@e2e.test", name: "junk", employeeId: "E5-junk", status: "active", user: "not-an-id", workSchedule: "nor-this" },
]);
await db.collection("users").insertMany(Object.entries(five).map(([k, p]) => ({ _id: p.user, email: `${k.toLowerCase()}@five.e2e.test`, name: k, workSchedule: salesShift })));
// Rostered onto Evening through yesterday — stored as the HRMS's form stores it: yesterday at midnight UTC. No punch.
await db.collection("rosterassignments").insertOne({ organization: null, user: five.lastDay.user, workSchedule: evening, effectiveFrom: new Date(Date.parse(`${YESTERDAY}T00:00:00Z`) - 3 * 24 * H), effectiveTo: new Date(`${YESTERDAY}T00:00:00Z`) });
await db.collection("attendances").insertMany([
  // A time zone changed mid-day, and the two records overlap.
  record(five.overlap.user, TODAY, { checkIn: at(TODAY, "09:00"), checkOut: at(TODAY, "12:40"), sessions: [{ checkIn: at(TODAY, "09:00"), checkOut: at(TODAY, "12:40") }] }),
  { ...record(five.overlap.user, TODAY, { checkIn: at(TODAY, "11:00"), checkOut: at(TODAY, "11:30"), sessions: [{ checkIn: at(TODAY, "11:00"), checkOut: at(TODAY, "11:30") }] }), timeZone: "Asia/Kolkata", date: new Date(`${TODAY}T00:00:00.000+05:30`) },
  record(five.overlapOpen.user, TODAY, { checkIn: at(TODAY, "09:00"), checkOut: null, sessions: [{ checkIn: at(TODAY, "09:00"), checkOut: null }] }),
  { ...record(five.overlapOpen.user, TODAY, { checkIn: at(TODAY, "11:00"), checkOut: at(TODAY, "11:30"), sessions: [{ checkIn: at(TODAY, "11:00"), checkOut: at(TODAY, "11:30") }] }), timeZone: "Asia/Kolkata", date: new Date(`${TODAY}T00:00:00.000+05:30`) },
  // Forgot to clock out last night (16 hours ago, still open); in and out again today.
  { ...record(five.forgot.user, YESTERDAY, { checkIn: new Date(Date.now() - 16 * H), checkOut: null, sessions: [{ checkIn: new Date(Date.now() - 16 * H), checkOut: null }] }), date: new Date(`${YESTERDAY}T00:00:00.000+04:00`) },
  record(five.forgot.user, TODAY, { checkIn: at(TODAY, "10:00"), checkOut: at(TODAY, "12:00"), sessions: [{ checkIn: at(TODAY, "10:00"), checkOut: at(TODAY, "12:00") }] }),
  // A session date nobody can read, beside a good one.
  record(five.badDate.user, TODAY, { checkIn: at(TODAY, "10:00"), checkOut: null, sessions: [{ checkIn: "not a date", checkOut: null }, { checkIn: at(TODAY, "10:00"), checkOut: null }] }),
]);
// Leave entered with a zone the runtime doesn't know.
await db.collection("leaverequests").insertOne({ user: five.badZone.user, type: "annual", status: "approved", halfDay: false, timeZone: "Dubai", startDate: at(TODAY, "00:00"), endDate: at(TODAY, "23:59") });

const lastDay = (await attendanceDay({ emails: ["lastday@e2e.test"], day: YESTERDAY }))[0];
check("a roster's last day, nobody punched: still the roster's shift (Evening), as the HRMS calendar has it", lastDay?.schedule.name === "Evening", lastDay?.schedule.name);
let day5: Awaited<ReturnType<typeof attendanceDay>> = [];
let threw = "";
try {
  day5 = await attendanceDay({ emails: [...Object.values(five).map((p) => p.email), "junk@e2e.test", "two@e2e.test"], day: TODAY });
} catch (err) {
  threw = (err as Error).message;
}
const of5 = (email: string) => day5.find((r) => r.email === email);
check("overlapping records: out at the latest clock-out, 12:40 — not the last-started session's 11:30", of5("overlap@e2e.test")?.attendance?.lastOut === at(TODAY, "12:40").toISOString(), of5("overlap@e2e.test")?.attendance?.lastOut);
check("…and with one still open: no last out, in now", of5("overlapopen@e2e.test")?.attendance?.lastOut === null && of5("overlapopen@e2e.test")?.now === "in", of5("overlapopen@e2e.test"));
check("last night's forgotten clock-out doesn't make today 'in': out at 12:00, out now", of5("forgot@e2e.test")?.attendance?.lastOut === at(TODAY, "12:00").toISOString() && of5("forgot@e2e.test")?.now === "out", of5("forgot@e2e.test"));
check("records nobody can read (a login and a schedule that aren't ids, a leave zone 'Dubai', a session date 'not a date') don't fail the batch", !threw && day5.length === 8, threw || day5.length);
check("…the junk employee comes back with no login: no record, the default shift", of5("junk@e2e.test")?.attendance === null && of5("junk@e2e.test")?.schedule.assigned === false, of5("junk@e2e.test"));
check("…the leave in zone 'Dubai' is read in the default zone: on leave today", of5("badzone@e2e.test")?.leave?.type === "annual", of5("badzone@e2e.test")?.leave);
check("…the unreadable session is skipped, the good one kept", of5("baddate@e2e.test")?.attendance?.sessions.length === 1 && of5("baddate@e2e.test")?.attendance?.firstIn === at(TODAY, "10:00").toISOString(), of5("baddate@e2e.test")?.attendance);
check("…and everyone else is untouched", of5("two@e2e.test")?.attendance?.sessions.length === 2, of5("two@e2e.test")?.attendance?.sessions.length);

console.log(`\nCase 6 — a night shift under an HR marker, a clock-in after midnight elsewhere, and junk numbers`);
const six = { night: { user: id(), email: "night@e2e.test" }, kolkata: { user: id(), email: "kolkata@e2e.test" }, junkNum: { user: id(), email: "junknum@e2e.test" }, badOut: { user: id(), email: "badout@e2e.test" } };
await db.collection("employees").insertMany(Object.entries(six).map(([k, p]) => ({ _id: id(), email: p.email, name: k, employeeId: `E6-${k}`, status: "active", user: p.user, workSchedule: salesShift })));
await db.collection("users").insertMany(Object.entries(six).map(([k, p]) => ({ _id: p.user, email: `${k.toLowerCase()}@six.e2e.test`, name: k, workSchedule: salesShift })));
await db.collection("attendances").insertMany([
  // Clocked in 6 hours ago (a night shift, on yesterday's record) — and today bulk-marked "holiday" by HR: no sessions.
  { ...record(six.night.user, YESTERDAY, { checkIn: new Date(Date.now() - 6 * H), checkOut: null, sessions: [{ checkIn: new Date(Date.now() - 6 * H), checkOut: null }] }), date: new Date(`${YESTERDAY}T00:00:00.000+04:00`) },
  record(six.night.user, TODAY, { status: "holiday", checkIn: null, checkOut: null, sessions: [] }),
  // Today's own record closed; a new clock-in an hour ago on the next day's record (their zone's midnight passed).
  record(six.kolkata.user, TODAY, { checkIn: at(TODAY, "00:10"), checkOut: at(TODAY, "00:20"), sessions: [{ checkIn: at(TODAY, "00:10"), checkOut: at(TODAY, "00:20") }] }),
  { ...record(six.kolkata.user, TODAY, { checkIn: new Date(Date.now() - H), checkOut: null, sessions: [{ checkIn: new Date(Date.now() - H), checkOut: null }] }), localDay: "2099-01-01", date: new Date("2099-01-01T00:00:00.000Z") },
  record(six.junkNum.user, TODAY, { checkIn: at(TODAY, "10:00"), checkOut: at(TODAY, "11:00"), workedMinutes: "abc", lateMinutes: "x", sessions: [{ checkIn: at(TODAY, "10:00"), checkOut: at(TODAY, "11:00") }] }),
  record(six.badOut.user, TODAY, { checkIn: at(TODAY, "10:00"), checkOut: null, sessions: [{ checkIn: at(TODAY, "09:00"), checkOut: at(TODAY, "09:30") }, { checkIn: at(TODAY, "10:00"), checkOut: "garbage" }] }),
]);
const day6 = await attendanceDay({ emails: Object.values(six).map((p) => p.email), day: TODAY });
const of6 = (email: string) => day6.find((r) => r.email === email);
check("a night shift still running under today's HR marker (holiday): in", of6("night@e2e.test")?.now === "in" && of6("night@e2e.test")?.attendance?.status === "holiday", of6("night@e2e.test"));
check("a clock-in an hour ago on the next day's record, after today's last clock-out: in", of6("kolkata@e2e.test")?.now === "in", of6("kolkata@e2e.test"));
check("worked and late minutes that aren't numbers read as 0, not null", of6("junknum@e2e.test")?.attendance?.workedMinutes === 0 && of6("junknum@e2e.test")?.attendance?.lateMinutes === 0, of6("junknum@e2e.test")?.attendance);
check("a clock-out that can't be read isn't 'still open': that session is left out", of6("badout@e2e.test")?.attendance?.sessions.length === 1 && of6("badout@e2e.test")?.attendance?.lastOut === at(TODAY, "09:30").toISOString() && of6("badout@e2e.test")?.now === "out", of6("badout@e2e.test"));

await mongoose.disconnect();
console.log(`\n${pass}/${pass + fail} checks passed${fail ? ` — ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
