/**
 * Checks, on a scratch database (2026-10-19):
 *   - where the LMS's mentors work (services/staffLookupService.ts): found by email, else by exact name when only one
 *     employee has it; office / wfh, location, status; a leaver passed over for the one still here; two with one
 *     name — no match;
 *   - Meeting Room 1 and 2 for the sales CRMs (services/crmRoomService.ts): one Dubai day of the rooms and every
 *     booking in them; booking only those rooms, one day, office hours, not in the past, never on top of another;
 *     two at once — one gets it; taken back by the booker or a CRM super admin only, and only what that CRM made;
 *   - the routes: signed, the organization named.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/crm-room-scratch bun --no-env-file src/scripts/crmRoomCheck.ts
 */
import mongoose from "mongoose";
import crypto from "node:crypto";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[\w-]*scratch[\w-]*$/.test(uri)) {
  console.error(`Refusing: needs a local scratch database, got ${uri}`);
  process.exit(1);
}
const SECRET = "crm-room-check-secret-0123456789abcdef0123456789";
Object.assign(process.env, {
  JWT_SECRET: "x".repeat(40), JWT_REFRESH_SECRET: "y".repeat(40), SUPER_ADMIN_EMAIL: "root@t.io", SUPER_ADMIN_PASSWORD: "x",
  INTEGRATION_CLIENT_ID: "crm-check", INTEGRATION_SECRET: SECRET, NODE_ENV: "test", SMTP_HOST: "",
});
delete process.env.CRM_ROOMS;
delete process.env.CRM_ROOM_HOURS;

const { runWithOrg } = await import("../utils/orgContext.js");
const rooms = await import("../services/crmRoomService.js");
const { staffWorkModes } = await import("../services/staffLookupService.js");
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
const DAY = "2030-01-15";
const at = (hhmm: string, day = DAY) => new Date(`${day}T${hhmm}:00+04:00`);
const NOW = at("08:00");
const hq = id(), other = id();
await db.collection("organizations").insertMany([
  { _id: hq, name: "Delta HQ", code: "HQ", status: "active", createdAt: at("08:00", "2026-01-01") },
  { _id: other, name: "Elsewhere", code: "EL", status: "active", createdAt: at("08:00", "2026-02-01") },
]);
const asha = id();
await db.collection("users").insertMany([{ _id: asha, name: "Asha", email: "asha@t.io", status: "active", organization: hq }]);
const room = (name: string, org = hq, active = true) => ({ _id: id(), organization: org, name, active, capacity: 6, location: "" });
const MR1 = room("Meeting Room 1"), MR2 = room("Meeting Room 2"), MR3 = room("Meeting Room 3"), POD = room("Pod 4");
await db.collection("meetingrooms").insertMany([MR1, MR2, MR3, POD]);
const inHq = <T>(fn: () => Promise<T>) => new Promise<T>((resolve, reject) => runWithOrg({ orgId: String(hq), isSuperAdmin: false }, () => { fn().then(resolve, reject); }));
const book = (o: Partial<Parameters<typeof rooms.bookCrmRoom>[0]>, now = NOW) =>
  inHq(() => rooms.bookCrmRoom({ crm: "sales", roomId: String(MR1._id), start: at("11:00"), end: at("12:00"), title: "Client call", bookerEmail: "jalwa@sales.io", bookerName: "Jalwa", ...o }, now))
    .then((b) => ({ ok: true as const, b }), (e: any) => ({ ok: false as const, status: e.statusCode as number, message: String(e.message) }));

step("1. Where mentors work");
await db.collection("employees").insertMany([
  { _id: id(), organization: hq, employeeCode: "E1", name: "Haffiz Khan", email: "haffiz@t.io", workMode: "office", location: "dubai", status: "active", designation: "Forex Mentor" },
  { _id: id(), organization: hq, employeeCode: "E2", name: "Mary Roy", email: "mary@t.io", workMode: "wfh", location: "india", status: "active", designation: "DM Mentor" },
  { _id: id(), organization: hq, employeeCode: "E3", name: "Libin  Paul", email: "libinpaul@t.io", status: "active", location: "dubai", designation: "Senior Mentor" },
  { _id: id(), organization: hq, employeeCode: "E4", name: "Old Self", email: "re@t.io", workMode: "wfh", status: "resigned" },
  { _id: id(), organization: hq, employeeCode: "E5", name: "Re Joined", email: "re@t.io", workMode: "office", location: "dubai", status: "probation" },
  { _id: id(), organization: hq, employeeCode: "E6", name: "Sam Twin", email: "sam1@t.io", status: "active" },
  { _id: id(), organization: hq, employeeCode: "E7", name: "Sam Twin", email: "sam2@t.io", status: "active" },
]);
const wm = await staffWorkModes([
  { email: "HAFFIZ@t.io", name: "x" }, { email: "mary@t.io" }, { email: "libin@t.io", name: "LIBIN PAUL" },
  { email: "re@t.io" }, { email: "sam@t.io", name: "Sam Twin" }, { email: "nobody@t.io", name: "Nobody" },
]);
check("by email, case aside: office · dubai · active", wm[0].matchedBy === "email" && wm[0].workMode === "office" && wm[0].location === "dubai" && wm[0].status === "active", j(wm[0]));
check("works from home: wfh · india", wm[1].workMode === "wfh" && wm[1].location === "india", j(wm[1]));
check("a different email: found by the exact name (spacing aside), with the HRMS email; no work mode set = office", wm[2].matchedBy === "name" && wm[2].hrmsEmail === "libinpaul@t.io" && wm[2].workMode === "office", j(wm[2]));
check("a leaver and a returner on one email: the one still here", wm[3].status === "probation" && wm[3].workMode === "office", j(wm[3]));
check("two people with one name: not a match", wm[4].matchedBy === null, j(wm[4]));
check("not in the HRMS: nothing", wm[5].matchedBy === null && wm[5].workMode === null, j(wm[5]));
const otherOrg = await staffWorkModes([{ email: "haffiz@t.io" }], String(other));
check("asked of another organization: not theirs", otherOrg[0].matchedBy === null, j(otherOrg));

step("2. One day of the CRM rooms");
const day0 = await inHq(() => rooms.crmRoomDay({ crm: "sales", day: DAY }));
check("only Meeting Room 1 and 2, office hours 10:00–19:00", day0.rooms.map((r) => r.name).join() === "Meeting Room 1,Meeting Room 2" && day0.open === "10:00" && day0.close === "19:00", j(day0));
let r = await book({});
check("Jalwa books Meeting Room 1, 11:00–12:00", r.ok && r.b.roomName === "Meeting Room 1" && r.b.holder === "Sales CRM · Jalwa" && r.b.mine, j(r));
const made: any = await MeetingBooking.findOne({ "source.system": "crm:sales" }).lean();
check("kept in the HRMS: sourced, no organiser (no login here), Dubai time", made?.organizer === null && made?.source?.ref === "jalwa@sales.io" && made?.timeZone === "Asia/Dubai", j(made));
r = await book({ bookerEmail: "asha@t.io", bookerName: "Asha", roomId: String(MR2._id) });
const ashas: any = await MeetingBooking.findOne({ "source.ref": "asha@t.io" }).lean();
check("someone with an HRMS login: they are its organiser", r.ok && String(ashas?.organizer) === String(asha), j(r));
await db.collection("meetingbookings").insertOne({ _id: id(), organization: hq, room: MR1._id, title: "HR review", start: at("15:00"), end: at("16:00"), timeZone: "Asia/Dubai", organizer: asha, participants: [], status: "booked", kind: "review", mode: "room" });
const day1 = await inHq(() => rooms.crmRoomDay({ crm: "sales", day: DAY, viewerEmail: "jalwa@sales.io" }));
check("the day shows every booking in the two rooms — the HRMS's own too, a review's title hidden", day1.bookings.length === 3 && day1.bookings.some((b) => b.title === "Review meeting" && !b.fromThisCrm), j(day1.bookings));
check("…which is Jalwa's to take back", day1.bookings.filter((b) => b.mine).length === 1);
const dayDraw = await inHq(() => rooms.crmRoomDay({ crm: "draw", day: DAY, viewerEmail: "jalwa@sales.io" }));
check("seen from another CRM: there, but not that CRM's", dayDraw.bookings.length === 3 && dayDraw.bookings.every((b) => !b.fromThisCrm && !b.mine));

step("3. Only what may be booked");
r = await book({ start: at("11:30"), end: at("12:30") });
check("on top of another: 409, saying who has it", !r.ok && r.status === 409 && /Sales CRM · Jalwa/.test(r.message), j(r));
r = await book({ roomId: String(MR3._id), start: at("13:00"), end: at("14:00") });
check("Meeting Room 3: 403", !r.ok && r.status === 403, j(r));
r = await book({ roomId: String(POD._id), start: at("13:00"), end: at("14:00") });
check("a pod: 403", !r.ok && r.status === 403, j(r));
r = await book({ start: at("09:30"), end: at("10:30") });
check("before 10:00: refused", !r.ok && r.status === 400 && /10:00 and 19:00/.test(r.message), j(r));
r = await book({ start: at("18:30"), end: at("19:30") });
check("past 19:00: refused", !r.ok && r.status === 400, j(r));
r = await book({ start: at("18:00"), end: at("10:30", "2030-01-16") });
check("into the next day: refused", !r.ok && r.status === 400, j(r));
r = await book({ start: at("13:00"), end: at("14:00") }, at("15:00"));
check("in the past: refused", !r.ok && r.status === 400 && /passed/.test(r.message), j(r));
r = await book({ start: at("13:00"), end: at("13:00") });
check("ending as it starts: refused", !r.ok && r.status === 400, j(r));
r = await book({ start: at("13:00"), end: at("14:00"), title: "  " });
check("no title: refused", !r.ok && r.status === 400, j(r));
r = await book({ start: at("13:00"), end: at("14:00"), crm: "banglore" });
check("an unknown CRM: refused", !r.ok && r.status === 400, j(r));
r = await book({ start: at("12:00"), end: at("13:00") });
check("starting as the last ends: fine (touching ends share)", r.ok, j(r));
r = await book({ start: at("18:00"), end: at("19:00") });
check("up to 19:00 exactly: fine", r.ok, j(r));

step("4. Two at once");
const both = await Promise.all(Array.from({ length: 6 }, (_, i) => book({ start: at("16:00"), end: at("17:00"), bookerEmail: `p${i}@sales.io`, bookerName: `P${i}` })));
const won = both.filter((x) => x.ok);
const held = await MeetingBooking.countDocuments({ room: MR1._id, status: "booked", start: { $lt: at("17:00") }, end: { $gt: at("16:00") } });
check("six people at once for one slot: one gets it, five told", won.length === 1 && held === 1 && both.filter((x) => !x.ok && x.status === 409).length === 5, j(both.map((x) => x.ok)));

step("5. Taking back");
const jalwas: any = await MeetingBooking.findOne({ "source.ref": "jalwa@sales.io", start: at("11:00") }).lean();
const cancel = (o: Partial<Parameters<typeof rooms.cancelCrmBooking>[0]>) =>
  inHq(() => rooms.cancelCrmBooking({ crm: "sales", id: String(jalwas._id), bookerEmail: "jalwa@sales.io", ...o })).then((x) => ({ ok: true, x }), (e: any) => ({ ok: false, status: e.statusCode }));
let c: any = await cancel({ bookerEmail: "neethu@sales.io" });
check("someone else: 403", !c.ok && c.status === 403, j(c));
c = await cancel({ crm: "draw", any: true });
check("another CRM, even its super admin: 404", !c.ok && c.status === 404, j(c));
const review: any = await MeetingBooking.findOne({ kind: "review" }).lean();
c = await inHq(() => rooms.cancelCrmBooking({ crm: "sales", id: String(review._id), bookerEmail: "x@t.io", any: true })).then(() => ({ ok: true }), (e: any) => ({ ok: false, status: e.statusCode }));
check("an HRMS booking, from a CRM: 404 — left alone", !c.ok && c.status === 404 && (await MeetingBooking.findById(review._id).lean() as any)?.status === "booked", j(c));
c = await cancel({});
check("the booker: taken back", c.ok && c.x.cancelled === true && (await MeetingBooking.findById(jalwas._id).lean() as any)?.status === "cancelled", j(c));
const p0: any = await MeetingBooking.findOne({ "source.system": "crm:sales", start: at("16:00"), status: "booked" }).lean();
c = await inHq(() => rooms.cancelCrmBooking({ crm: "sales", id: String(p0._id), bookerEmail: "admin@sales.io", any: true })).then((x) => ({ ok: true, x }), (e: any) => ({ ok: false, status: e.statusCode }));
check("the CRM's super admin: any it made", c.ok, j(c));
r = await book({ start: at("11:00"), end: at("12:00"), bookerEmail: "neethu@sales.io", bookerName: "Neethu" });
check("the freed slot can be booked again", r.ok, j(r));

step("6. The routes");
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
  if (sign) Object.assign(headers, { "x-delta-client": "crm-check", "x-delta-timestamp": ts, "x-delta-nonce": nonce, "x-delta-signature": signRequest(SECRET, method, `/api/v1/integrations${path}`, ts, nonce, raw) });
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/integrations${path}`, { method, headers, ...(raw ? { body: raw } : {}) });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}
const q = (o: Record<string, string>) => new URLSearchParams({ organizationId: String(hq), ...o }).toString();
let x = await call("GET", `/meetings/crm-rooms?${q({ crm: "sales", day: DAY })}`, undefined, false);
check("unsigned: 401", x.status === 401, String(x.status));
x = await call("GET", `/meetings/crm-rooms?crm=sales&day=${DAY}`);
check("no organization named: 400", x.status === 400, String(x.status));
x = await call("GET", `/meetings/crm-rooms?${q({ crm: "sales", day: DAY, viewerEmail: "neethu@sales.io" })}`);
check("the day through the route", x.status === 200 && x.body?.data?.rooms?.length === 2 && x.body.data.bookings.some((b: any) => b.mine), j(x.body));
x = await call("POST", "/meetings/crm-bookings", { organizationId: String(hq), crm: "draw", roomId: String(MR2._id), start: at("14:00").toISOString(), end: at("14:30").toISOString(), title: "Route call", bookerEmail: "aparna@draw.io", bookerName: "Aparna" });
check("booked through the route: 201", x.status === 201 && x.body?.data?.holder === "Draw CRM · Aparna", j(x.body));
x = await call("POST", "/meetings/crm-bookings", { organizationId: String(hq), crm: "draw", roomId: String(MR2._id), start: "nope", end: at("14:30").toISOString(), title: "x", bookerEmail: "a@d.io" });
check("bad times: 400", x.status === 400, String(x.status));
const routeId = (await MeetingBooking.findOne({ "source.ref": "aparna@draw.io" }).lean() as any)._id;
x = await call("DELETE", `/meetings/crm-bookings/${routeId}?${q({ crm: "draw", bookerEmail: "aparna@draw.io" })}`);
check("taken back through the route", x.status === 200 && x.body?.data?.cancelled === true, j(x.body));
x = await call("POST", "/directory/work-modes", { people: [{ email: "mary@t.io" }], organizationId: String(hq) });
check("work modes through the route", x.status === 200 && x.body?.data?.[0]?.workMode === "wfh", j(x.body));
x = await call("POST", "/directory/work-modes", { people: [] });
check("nobody asked about: 400", x.status === 400, String(x.status));
server.close();

console.log(`\n${pass}/${pass + fail} checks passed${fail ? ` — ${fail} FAILED` : ""}`);
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
