/**
 * Checks attendanceNow (GET /integrations/directory/attendance-now) on a scratch
 * database: who is clocked in, on leave today, or neither — the Sales CRM's live
 * lead split asks it. Refuses anything but a local scratch database.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hrms-attendance-scratch bun src/scripts/attendanceNowCheck.ts
 */
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[\w-]*scratch[\w-]*$/.test(uri)) {
  console.error(`Refusing: needs a local scratch database, got ${uri}`);
  process.exit(1);
}
const { attendanceNow } = await import("../services/directoryService.js");

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}${ok ? "" : ` — ${detail}`}`);
};

await mongoose.connect(uri);
const db = mongoose.connection.db!;
for (const c of ["employees", "attendances", "leaverequests"]) await db.collection(c).deleteMany({});

const H = 3_600_000, now = Date.now();
const id = () => new mongoose.Types.ObjectId();
const people = {
  inNow: { user: id(), email: "in@e2e.test" },
  outAgain: { user: id(), email: "out@e2e.test" },
  stale: { user: id(), email: "stale@e2e.test" },
  leave: { user: id(), email: "leave@e2e.test" },
  halfIn: { user: id(), email: "halfin@e2e.test" },
  wfh: { user: id(), email: "wfh@e2e.test" },
  gone: { user: id(), email: "gone@e2e.test" },
};
await db.collection("employees").insertMany(Object.entries(people).map(([k, p]) => ({
  _id: id(), user: p.user, email: p.email, name: k, employeeId: `E-${k}`, status: k === "gone" ? "resigned" : "active",
})));
const day = (t: number) => new Date(t - (t % (24 * H)));
await db.collection("attendances").insertMany([
  { user: people.inNow.user, date: day(now), checkIn: new Date(now - 2 * H), checkOut: null, status: "present", timeZone: "Asia/Dubai" },
  { user: people.outAgain.user, date: day(now), checkIn: new Date(now - 5 * H), checkOut: new Date(now - H), status: "present", timeZone: "Asia/Dubai" },
  { user: people.stale.user, date: day(now - 48 * H), checkIn: new Date(now - 40 * H), checkOut: null, status: "present", timeZone: "Asia/Dubai" },
  { user: people.halfIn.user, date: day(now), checkIn: new Date(now - H), checkOut: null, status: "present", timeZone: "Asia/Dubai" },
  { user: people.gone.user, date: day(now), checkIn: new Date(now - H), checkOut: null, status: "present", timeZone: "Asia/Dubai" },
]);
const leave = (user: mongoose.Types.ObjectId, type: string, halfDay = false) => ({
  user, type, status: "approved", halfDay, timeZone: "Asia/Dubai",
  startDate: new Date(now - 24 * H), endDate: new Date(now + 24 * H),
});
await db.collection("leaverequests").insertMany([
  leave(people.leave.user, "annual"),
  leave(people.halfIn.user, "annual", true),
  leave(people.wfh.user, "wfh"),
]);

const rows = await attendanceNow({ emails: [...Object.values(people).map((p) => p.email), "nobody@e2e.test"] });
const of = (email: string) => rows.find((r) => r.email === email);
console.log("\nattendanceNow");
check("clocked in, not out: in, since their check-in", of("in@e2e.test")?.state === "in" && !!of("in@e2e.test")?.since, JSON.stringify(of("in@e2e.test")));
check("clocked out again: out", of("out@e2e.test")?.state === "out", JSON.stringify(of("out@e2e.test")));
check("a check-in left open for 40 hours is a forgotten clock-out: out", of("stale@e2e.test")?.state === "out", JSON.stringify(of("stale@e2e.test")));
check("on approved leave today: leave, with its type", of("leave@e2e.test")?.state === "leave" && of("leave@e2e.test")?.leave?.type === "annual", JSON.stringify(of("leave@e2e.test")));
check("half a day of leave but clocked in: in", of("halfin@e2e.test")?.state === "in" && of("halfin@e2e.test")?.leave?.halfDay === true, JSON.stringify(of("halfin@e2e.test")));
check("working from home is not leave: out until they clock in", of("wfh@e2e.test")?.state === "out" && of("wfh@e2e.test")?.leave === null, JSON.stringify(of("wfh@e2e.test")));
check("somebody who has left, and an email nobody has: not answered", !of("gone@e2e.test") && !of("nobody@e2e.test"), JSON.stringify(rows.map((r) => r.email)));

await mongoose.disconnect();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
