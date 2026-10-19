/**
 * Checks the LMS's class pods (services/classPodService.ts, the signed /integrations/meetings routes) and the
 * first-writer-wins room claim (utils/roomClaim.ts) on a scratch database:
 *   - the pods by name, in the order asked; a retired room or another organization's left out;
 *   - a class gets the first free pod; a second at the same time the next; touching ends share a pod;
 *   - kept as it is when nothing changed; moved (a new booking, the old cancelled) when its time changes, keeping its
 *     pod when it can; no pod free — it says so and lets go of the one it had;
 *   - released; the list of what the LMS holds; bookings over a stretch with who has them;
 *   - twenty classes asking at once for seven pods: seven held, never two in one pod;
 *   - two people booking one room at once: one gets it; an edit onto a taken slot is put back;
 *   - the routes: signed only, the organization named, bad input refused; no reminders for class pods.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/class-pod-scratch bun --no-env-file src/scripts/classPodCheck.ts
 */
import mongoose from "mongoose";
import crypto from "node:crypto";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[\w-]*scratch[\w-]*$/.test(uri)) {
  console.error(`Refusing: needs a local scratch database, got ${uri}`);
  process.exit(1);
}
const SECRET = "class-pod-check-secret-0123456789abcdef0123456789";
Object.assign(process.env, {
  JWT_SECRET: "x".repeat(40), JWT_REFRESH_SECRET: "y".repeat(40), SUPER_ADMIN_EMAIL: "root@t.io", SUPER_ADMIN_PASSWORD: "x",
  INTEGRATION_CLIENT_ID: "lms-check", INTEGRATION_SECRET: SECRET, NODE_ENV: "test", SMTP_HOST: "",
});

const { runWithOrg } = await import("../utils/orgContext.js");
const pods = await import("../services/classPodService.js");
const { MeetingService } = await import("../services/meetingService.js");
const { MeetingBooking } = await import("../models/MeetingBooking.js");
const { signRequest } = await import("../utils/signing.js");

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}${ok ? "" : ` — ${detail}`}`);
};
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
const j = (v: unknown) => JSON.stringify(v).slice(0, 300);

await mongoose.connect(uri);
const db = mongoose.connection.db!;
await db.dropDatabase();
await MeetingBooking.init();

const id = () => new mongoose.Types.ObjectId();
const at = (hhmm: string, day = "2026-10-19") => new Date(`${day}T${hhmm}:00+04:00`);
const hq = id(), other = id();
await db.collection("organizations").insertMany([
  { _id: hq, name: "Delta HQ", code: "HQ", status: "active", createdAt: at("08:00", "2026-01-01") },
  { _id: other, name: "Elsewhere", code: "EL", status: "active", createdAt: at("08:00", "2026-02-01") },
]);
const mentor = id(), asha = id(), bilal = id();
await db.collection("users").insertMany([
  { _id: mentor, name: "Mentor Mo", email: "mo@t.io", status: "active", organization: hq },
  { _id: asha, name: "Asha", email: "asha@t.io", status: "active", organization: hq },
  { _id: bilal, name: "Bilal", email: "bilal@t.io", status: "active", organization: hq },
]);
const room = (name: string, org = hq, active = true) => ({ _id: id(), organization: org, name, active, capacity: 4, location: "" });
const P = ["Pod 4", "Pod 6", "Pod 7", "Pod 8", "Pod 9", "Pod 10", "Pod 11"].map((n) => room(n));
const pod5 = room("Pod 5"), retired = room("Pod 12", hq, false), theirs = room("Pod 13", other);
await db.collection("meetingrooms").insertMany([...P, pod5, retired, theirs]);
const ids = P.map((r) => String(r._id));
const inHq = <T>(fn: () => Promise<T>) => new Promise<T>((resolve, reject) => runWithOrg({ orgId: String(hq), isSuperAdmin: false }, () => { fn().then(resolve, reject); }));
const hold = (ref: string, s: string, e: string, extra: Partial<Parameters<typeof pods.holdForClass>[0]> = {}) =>
  inHq(() => pods.holdForClass({ ref, roomIds: ids, start: at(s), end: at(e), title: `Class ${ref}`, label: `LMS class · Mentor ${ref}`, ...extra }));

step("1. The pods by name");
const got = await inHq(() => pods.podsNamed(["Pod 6", "pod 4", "Pod 12", "Pod 13", "Pod 99"]));
check("in the order asked, case aside; retired, another organization's and unknown left out", got.map((r) => r.name).join() === "Pod 6,Pod 4", j(got));

step("2. A pod per class");
let a = await hold("c1", "10:00", "11:00", { organizerEmail: "MO@t.io" });
check("the first class: Pod 4", a.ok && a.booking.roomName === "Pod 4" && a.booking.classRef === "c1" && a.booking.holder === "LMS class · Mentor c1", j(a));
const b1: any = await MeetingBooking.findOne({ "source.ref": "c1" }).lean();
check("…its organiser the mentor's login, matched by email; no reminders ticked", String(b1?.organizer) === String(mentor) && b1?.mode === "room" && b1?.source?.system === "lms", j(b1));
const b2 = await hold("c2", "10:30", "11:30");
check("another overlapping it: Pod 6", b2.ok && b2.booking.roomName === "Pod 6", j(b2));
const b3 = await hold("c3", "11:00", "12:00");
check("one starting as the first ends: Pod 4 again (touching ends share)", b3.ok && b3.booking.roomName === "Pod 4", j(b3));
const noLogin: any = await MeetingBooking.findOne({ "source.ref": "c2" }).lean();
check("a mentor with no login here: no organiser, the label says whose", noLogin?.organizer === null && noLogin?.source?.label === "LMS class · Mentor c2", j(noLogin));

step("3. Kept, moved, or no pod free");
const same = await hold("c1", "10:00", "11:00", { title: "Renamed class" });
check("nothing moved: the same booking, its title brought up to date", same.ok && !same.changed && same.booking.id === (a as any).booking.id && same.booking.title === "Renamed class", j(same));
const moved = await hold("c1", "10:15", "11:00");
check("its time changed: a new booking, the same pod kept (it is free)", moved.ok && moved.changed && moved.booking.roomName === "Pod 4" && moved.booking.id !== (a as any).booking.id, j(moved));
check("…the old one cancelled", (await MeetingBooking.findById((a as any).booking.id).lean() as any)?.status === "cancelled");
// Fill every pod 14:00–15:00
for (let i = 0; i < 7; i++) await hold(`f${i}`, "14:00", "15:00");
const full = await hold("c4", "14:30", "15:30");
check("all seven taken: no pod, and why", !full.ok && full.reason === "no_room" && /No pod is free/.test(full.message), j(full));
const c3moved = await hold("c3", "14:00", "14:45");
check("a class moved into a full hour: no pod — and the one it had is let go", !c3moved.ok && (await MeetingBooking.countDocuments({ "source.ref": "c3", status: "booked" })) === 0);

step("4. Released; what the LMS holds; who has what");
const rel = await inHq(() => pods.releaseForClass("c2"));
check("released: its booking cancelled", rel.released === 1 && (await MeetingBooking.countDocuments({ "source.ref": "c2", status: "booked" })) === 0);
const holds = await inHq(() => pods.lmsHolds(at("00:00")));
check("the LMS's holds: c1 and the seven at 14:00", holds.length === 8 && holds.some((h) => h.ref === "c1"), j(holds.map((h) => h.ref)));
await db.collection("meetingbookings").insertOne({ organization: hq, room: P[1]._id, title: "Staff huddle", start: at("09:00"), end: at("09:30"), organizer: asha, status: "booked", participants: [], kind: "meeting", mode: "room", firedStages: [] });
const day = await inHq(() => pods.podBookings(ids, at("00:00"), at("23:59")));
check("a day's bookings in the pods, staff's too, with who has each", day.some((d) => d.title === "Staff huddle" && d.holder === "Asha" && d.classRef === null) && day.some((d) => d.classRef === "c1"), j(day.slice(0, 3)));
const huddle = await hold("c5", "09:00", "09:20", { roomIds: [ids[1]] });
check("a staff meeting holds its pod: a class asking only for it gets none", !huddle.ok);

step("5. Twenty classes at once for seven pods");
const many = await Promise.all(Array.from({ length: 20 }, (_, i) => hold(`r${i}`, "17:00", "18:00")));
const held = many.filter((r) => r.ok) as Array<{ ok: true; booking: { roomName: string } }>;
const roomsUsed = held.map((r) => r.booking.roomName);
const live = await MeetingBooking.find({ status: "booked", start: { $lt: at("18:00") }, end: { $gt: at("17:00") } }).lean();
check("seven held, thirteen told no pod is free", held.length === 7 && many.length - held.length === 13, `${held.length} held`);
check("never two in one pod", new Set(roomsUsed).size === 7 && new Set(live.map((b) => String(b.room))).size === live.length, j(roomsUsed));

const twice = await Promise.all([hold("dup", "21:00", "22:00"), hold("dup", "21:00", "22:00"), hold("dup", "21:00", "22:00")]);
check("one class asking three times at once: one pod, all three told the same", (await MeetingBooking.countDocuments({ "source.ref": "dup", status: "booked" })) === 1
  && new Set(twice.map((t: any) => t.booking?.id)).size === 1, j(twice.map((t: any) => t.booking?.roomName)));

step("6. People booking one room at once");
const svc = new MeetingService();
const people = [asha, bilal].map((u) => inHq(() => svc.createBooking({ title: `Meet ${u}`, start: at("19:00"), end: at("19:30"), timeZone: "Asia/Dubai", room: String(pod5._id), kind: "meeting", mode: "room", participants: [] } as never, { userId: String(u), roleName: "Employee" } as never)).then(() => "ok", (e: any) => e.statusCode));
const outcome = await Promise.all(people);
check("one gets the room, the other is told it was just booked", outcome.filter((o) => o === "ok").length === 1 && outcome.includes(409), j(outcome));
check("…one booking in it", (await MeetingBooking.countDocuments({ room: pod5._id, status: "booked" })) === 1);
const early = await inHq(() => svc.createBooking({ title: "Early", start: at("18:00"), end: at("18:30"), timeZone: "Asia/Dubai", room: String(pod5._id), kind: "meeting", mode: "room", participants: [] } as never, { userId: String(asha), roleName: "Super Admin" } as never)) as any;
// An edit onto the taken 19:00 slot, racing nobody, is refused by the clash test before it writes.
const edit = await inHq(() => svc.updateBooking(String(early._id), { title: "Early", start: at("19:00"), end: at("19:30"), timeZone: "Asia/Dubai", room: String(pod5._id), kind: "meeting", mode: "room", participants: [] } as never, { userId: String(asha), roleName: "Super Admin" } as never)).then(() => "ok", (e: any) => e.statusCode);
check("an edit onto a taken slot: refused, left where it was", edit === 409 && (await MeetingBooking.findById(early._id).lean() as any)?.start.getTime() === at("18:00").getTime(), String(edit));

step("7. The routes");
const express = (await import("express")).default;
const routes = (await import("../routes/integrationRoutes.js")).default;
const app = express();
app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
app.use("/api/v1/integrations", routes);
const server = app.listen(0);
const port = (server.address() as any).port;
async function call(method: string, path: string, body?: unknown, sign = true) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const ts = String(Date.now()), nonce = crypto.randomUUID();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (sign) Object.assign(headers, { "x-delta-client": "lms-check", "x-delta-timestamp": ts, "x-delta-nonce": nonce, "x-delta-signature": signRequest(SECRET, method, `/api/v1/integrations${path}`, ts, nonce, raw) });
  const r = await fetch(`http://127.0.0.1:${port}/api/v1/integrations${path}`, { method, headers, ...(raw ? { body: raw } : {}) });
  return { status: r.status, body: await r.json().catch(() => ({})) as any };
}
const q = (o: Record<string, string>) => new URLSearchParams({ organizationId: String(hq), ...o }).toString();
let r = await call("GET", `/meetings/pods?${q({ names: "Pod 4,Pod 6" })}`, undefined, false);
check("unsigned: 401", r.status === 401, String(r.status));
r = await call("GET", `/meetings/pods?names=Pod%204`);
check("no organization named: 400", r.status === 400, String(r.status));
r = await call("GET", `/meetings/pods?${q({ names: "Pod 4,Pod 6" })}`);
check("the pods", r.status === 200 && r.body?.data?.map((x: any) => x.name).join() === "Pod 4,Pod 6", j(r.body));
r = await call("PUT", `/meetings/class-pods/route-1`, { organizationId: String(hq), rooms: ids, start: at("20:00").toISOString(), end: at("21:00").toISOString(), title: "Route class", label: "LMS class · Route" });
check("a pod held through the route", r.status === 200 && r.body?.data?.ok === true && r.body.data.booking.roomName === "Pod 4", j(r.body));
r = await call("PUT", `/meetings/class-pods/route-2`, { organizationId: String(hq), rooms: ids, start: "nope", end: at("21:00").toISOString() });
check("bad times: 400", r.status === 400, String(r.status));
r = await call("PUT", `/meetings/class-pods/route-3`, { organizationId: String(hq), rooms: [String(theirs._id)], start: at("20:00").toISOString(), end: at("21:00").toISOString() });
check("another organization's room: refused", r.status === 400, j(r.body));
r = await call("GET", `/meetings/pod-bookings?${q({ rooms: ids.join(","), from: at("00:00").toISOString(), to: at("23:59").toISOString() })}`);
check("a day's pod bookings", r.status === 200 && r.body?.data?.some((x: any) => x.classRef === "route-1"), String(r.status));
r = await call("GET", `/meetings/pod-bookings?${q({ rooms: ids.join(","), from: at("00:00").toISOString(), to: at("00:00", "2027-01-01").toISOString() })}`);
check("more than 62 days at once: 400", r.status === 400);
r = await call("GET", `/meetings/class-pods?${q({ from: at("00:00").toISOString() })}`);
check("what the LMS holds", r.status === 200 && r.body?.data?.some((x: any) => x.ref === "route-1"));
r = await call("DELETE", `/meetings/class-pods/route-1?${q({})}`);
check("released through the route", r.status === 200 && r.body?.data?.released === 1, j(r.body));
server.close();

step("8. No reminders for class pods");
const reminder = (await import("node:fs")).readFileSync(new URL("../jobs/meetingReminderJob.ts", import.meta.url), "utf8");
check("the reminder job leaves other systems' bookings alone", /"source\.system": \{ \$in: \[null, ""\] \}/.test(reminder));

console.log(`\n${pass}/${pass + fail} checks passed${fail ? ` — ${fail} FAILED` : ""}`);
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
