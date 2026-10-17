/**
 * Checks hrmsWatchForPortal (GET /service/hrms-watch, for the Root portal's Pending → HRMS tab) on a scratch
 * database: leave and regularization pending with the requester's department, hiring (with HR / with finance),
 * office keeping not sorted, procurement not finished by stage, who is on leave today — decided, finished and other
 * days left out — and the route refuses a missing or wrong secret. Refuses anything but a local scratch database.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hrms-watch-scratch ROOT_ERP_SECRET=<anything> \
 *     bun --no-env-file src/scripts/hrmsWatchCheck.ts
 */
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[\w-]*scratch[\w-]*$/.test(uri)) {
  console.error(`Refusing: needs a local scratch database, got ${uri}`);
  process.exit(1);
}
const SECRET = process.env.ROOT_ERP_SECRET ?? "";
if (!SECRET) {
  console.error("Set ROOT_ERP_SECRET (any value) so the route can be exercised");
  process.exit(1);
}

const { hrmsWatchForPortal } = await import("../services/hrmsWatchService.js");
const { User } = await import("../models/User.js");
const { Employee } = await import("../models/Employee.js");
const { Department } = await import("../models/Department.js");
const { LeaveRequest } = await import("../models/LeaveRequest.js");
const { Regularization } = await import("../models/Regularization.js");
const { JobRequisition } = await import("../models/JobRequisition.js");
const { OfficeKeepingRequest } = await import("../models/OfficeKeepingRequest.js");
const { Procurement } = await import("../models/Procurement.js");

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}${ok ? "" : ` — ${detail}`}`);
};
const same = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

await mongoose.connect(uri);
const models = [User, Employee, Department, LeaveRequest, Regularization, JobRequisition, OfficeKeepingRequest, Procurement] as unknown as mongoose.Model<unknown>[];
for (const m of models) await m.collection.deleteMany({});

const id = () => new mongoose.Types.ObjectId();
const DAY = 86_400_000, now = Date.now();
const ago = (days: number) => new Date(now - days * DAY);
// Leave dates as the app stores them: midnight UTC of the Gulf day.
const gulfDay = (offset: number) => new Date(`${new Date(now + 4 * 3_600_000 + offset * DAY).toISOString().slice(0, 10)}T00:00:00Z`);

const sales = id(), media = id();
await Department.collection.insertMany([{ _id: sales, name: "Sales" }, { _id: media, name: "Media" }]);
const asha = id(), bilal = id(), cara = id(), nodept = id();
await User.collection.insertMany([
  { _id: asha, name: "Asha", email: "Asha@T.io", status: "active" },
  { _id: bilal, name: "Bilal", email: "bilal@t.io", status: "active" },
  { _id: cara, name: "Cara", email: "cara@t.io", status: "active" },
  { _id: nodept, name: "No Dept", email: "nodept@t.io", status: "active" },
]);
await Employee.collection.insertMany([
  { _id: id(), user: asha, department: sales, name: "Asha", employeeCode: "E1" },
  { _id: id(), user: bilal, department: media, name: "Bilal", employeeCode: "E2" },
  { _id: id(), user: cara, department: sales, name: "Cara", employeeCode: "E3" },
]);
await LeaveRequest.collection.insertMany([
  { user: asha, type: "annual", days: 2, startDate: gulfDay(3), endDate: gulfDay(4), reason: "Trip", status: "pending", createdAt: ago(2) },
  { user: nodept, type: "sick", days: 1, startDate: gulfDay(1), endDate: gulfDay(1), reason: "Flu", status: "pending", createdAt: ago(1) },
  { user: bilal, type: "annual", days: 1, startDate: gulfDay(5), endDate: gulfDay(5), status: "rejected", createdAt: ago(1) },        // decided
  // On leave today: Cara (today only), Bilal (yesterday to tomorrow); Asha's leave tomorrow is not today.
  { user: cara, type: "sick", days: 1, startDate: gulfDay(0), endDate: gulfDay(0), status: "approved", createdAt: ago(1) },
  { user: bilal, type: "annual", days: 3, startDate: gulfDay(-1), endDate: gulfDay(1), status: "approved", createdAt: ago(5) },
  { user: asha, type: "annual", days: 1, startDate: gulfDay(1), endDate: gulfDay(1), status: "approved", createdAt: ago(5) },
  { user: asha, type: "annual", days: 1, startDate: gulfDay(0), endDate: gulfDay(0), status: "cancelled", createdAt: ago(5) },      // cancelled
]);
await Regularization.collection.insertMany([
  { user: bilal, type: "missed_punch", date: ago(3), resultingStatus: "present", reason: "Forgot", status: "pending", escalated: true, createdAt: ago(2) },
  { user: cara, type: "late", date: ago(4), status: "approved", createdAt: ago(3) },
]);
await JobRequisition.collection.insertMany([
  { title: "Video editor", type: "new_headcount", headcount: 2, department: media, raisedBy: bilal, status: "pending", createdAt: ago(6) },
  { title: "Sales exec", type: "replacement", headcount: 1, department: sales, raisedBy: asha, status: "finance_pending", createdAt: ago(3) },
  { title: "Filled", type: "replacement", department: sales, raisedBy: asha, status: "filled", createdAt: ago(30) },
]);
await OfficeKeepingRequest.collection.insertMany([
  { issue: "Broken chair", location: "2nd floor", requestedBy: asha, status: "requested", createdAt: ago(1) },
  { issue: "AC leaking", location: "Studio", requestedBy: bilal, status: "arriving", handledBy: cara, createdAt: ago(2) },
  { issue: "Bulb", location: "Kitchen", requestedBy: cara, status: "sorted", createdAt: ago(9) },
]);
await Procurement.collection.insertMany([
  { item: "Camera", category: "equipment", quantity: 1, estimatedCost: 9000, currency: "AED", department: media, requestedBy: bilal, status: "requested", createdAt: ago(4) },
  { item: "Laptops", quantity: 3, estimatedCost: 12000, currency: "AED", department: sales, requestedBy: asha, status: "hr_approved", createdAt: ago(3) },
  { item: "Chairs", quantity: 6, estimatedCost: 3000, department: null, requestedBy: cara, status: "approved", createdAt: ago(2) },
  { item: "Mics", quantity: 2, estimatedCost: 800, department: media, requestedBy: bilal, status: "ordered", createdAt: ago(8) },
  { item: "Old", quantity: 1, department: media, requestedBy: bilal, status: "received", createdAt: ago(20) },
]);

console.log("\nCase 1 — what waits, with departments");
const d = await hrmsWatchForPortal(now);
same("counts", d.counts, { leave: 2, regularization: 1, hiring: 2, hiring_with_finance: 1, office_keeping: 2, office_keeping_arriving: 1,
  procurement: 4, procurement_waiting: 2, on_leave_today: 2 });
const al = d.items.leave.find((x) => x.person === "Asha");
check("leave: Asha's, Sales, dates, reason, email lowercase", !!al && al.department === "Sales" && al.days === 2 && al.reason === "Trip" && al.email === "asha@t.io"
  && al.code === "E1" && /^\d{4}-\d{2}-\d{2}$/.test(al.from), JSON.stringify(al));
check("leave: somebody with no employee record has no department", d.items.leave.find((x) => x.person === "No Dept")?.department === "");
check("oldest first", d.items.leave[0]?.person === "Asha");
const rg = d.items.regularization[0];
check("regularization: Bilal, Media, escalated, type", rg?.person === "Bilal" && rg.department === "Media" && rg.escalated === true && rg.type === "missed punch", JSON.stringify(rg));
const hf = d.items.hiring.find((x) => x.title === "Sales exec"), hh = d.items.hiring.find((x) => x.title === "Video editor");
check("hiring: its own department, stage with HR / with finance, headcount", hf?.stage === "with_finance" && hf.department === "Sales" && hh?.stage === "with_hr" && hh.headcount === 2, JSON.stringify(d.items.hiring));
const ok2 = d.items.officeKeeping.find((x) => x.issue === "AC leaking");
check("office keeping: requester's department, stage, who is handling it", ok2?.department === "Media" && ok2.stage === "arriving" && ok2.handledBy === "Cara", JSON.stringify(ok2));
same("procurement stages", d.items.procurement.map((x) => [x.item, x.stage]).sort(), [["Camera", "with_hr"], ["Chairs", "to_order"], ["Laptops", "with_finance"], ["Mics", "ordered"]]);
check("procurement with no department of its own: the requester's", d.items.procurement.find((x) => x.item === "Chairs")?.department === "Sales");
same("on leave today: Bilal (Media) and Cara (Sales), by department", d.items.onLeaveToday.map((x) => [x.person, x.department]), [["Bilal", "Media"], ["Cara", "Sales"]]);

console.log("\nCase 2 — left out");
check("decided leave and regularization, filled hiring, sorted office keeping, received purchases: none listed",
  !d.items.leave.some((x) => x.person === "Bilal") && d.items.regularization.length === 1 && !d.items.hiring.some((x) => x.title === "Filled")
  && !d.items.officeKeeping.some((x) => x.issue === "Bulb") && !d.items.procurement.some((x) => x.item === "Old"));
check("leave tomorrow and cancelled leave: not on leave today", !d.items.onLeaveToday.some((x) => x.person === "Asha"));

console.log("\nCase 3 — the route");
try {
  const express = (await import("express")).default;
  const portalRoutes = (await import("../routes/portalRoutes.js")).default;
  const app = express();
  app.use(express.json());
  app.use("/api/v1/service", portalRoutes);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const get = async (secret?: string) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/v1/service/hrms-watch`, { headers: secret ? { "x-portal-secret": secret } : {} });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  same("no secret: 401", (await get()).status, 401);
  same("a wrong secret: 401", (await get("x".repeat(SECRET.length))).status, 401);
  const r = await get(SECRET);
  check("the right one: the same answer", r.status === 200 && r.body?.data?.counts?.leave === 2 && r.body.data.items.onLeaveToday.length === 2, JSON.stringify(r.body).slice(0, 300));
  server.close();
} catch (err) {
  check("the route could be mounted", false, String(err));
}

await mongoose.disconnect();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
