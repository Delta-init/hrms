/**
 * Checks hrmsReportForPortal (GET /service/hrms-report, for the Root portal's Reports → HRMS tab) on a scratch
 * database, for September 2026 in Gulf time: attendance (weekends and other months left out, a record from before
 * organizations counted in the first), leave starting in the month, regularization raised in it, hiring (requisitions,
 * candidates, offers sent and signed, hired), joiners and exits (relieved by last day), headcount now, the month's
 * payroll, purchase and office-keeping requests, overtime and reimbursements — each by person and department; a second
 * organization in its own currency; bad dates and an unknown organization refused; the route refuses a missing or
 * wrong secret. Refuses anything but a local scratch database.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hrms-report-scratch ROOT_ERP_SECRET=<anything> \
 *     bun --no-env-file src/scripts/hrmsReportCheck.ts
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

const { hrmsReportForPortal } = await import("../services/hrmsReportService.js");

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}${ok ? "" : ` — ${detail}`}`);
};
const same = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const step = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);

await mongoose.connect(uri);
const db = mongoose.connection.db!;
await db.dropDatabase();

const id = () => new mongoose.Types.ObjectId();
const g = (day: string, hhmm = "12:00") => new Date(`${day}T${hhmm}:00+04:00`);
const FROM = "2026-08-31T20:00:00.000Z", TO = "2026-09-30T19:59:59.999Z";
const ins = (c: string, docs: Record<string, unknown>[]) => db.collection(c).insertMany(docs.map((d) => ({ createdAt: g("2026-09-01"), updatedAt: g("2026-09-01"), ...d })));

const hq = id(), blr = id();
await ins("organizations", [
  { _id: hq, name: "Delta HQ", code: "HQ", currency: "AED", status: "active", createdAt: g("2026-01-01") },
  { _id: blr, name: "Delta Bangalore", code: "BLR", currency: "INR", status: "active", createdAt: g("2026-02-01") },
]);
const sales = id(), media = id();
await ins("departments", [{ _id: sales, name: "Sales" }, { _id: media, name: "Media" }]);
const asha = id(), bilal = id(), cara = id(), ravi = id();
await ins("users", [
  { _id: asha, name: "Asha", email: "asha@t.io" }, { _id: bilal, name: "Bilal", email: "bilal@t.io" },
  { _id: cara, name: "Cara", email: "cara@t.io" }, { _id: ravi, name: "Ravi", email: "ravi@t.io" },
]);
const eAsha = id(), eBilal = id(), eCara = id(), eDana = id(), eXan = id();
await ins("employees", [
  { _id: eAsha, organization: hq, user: asha, name: "Asha", employeeCode: "E1", department: sales, status: "active", joiningDate: g("2025-01-01") },
  { _id: eBilal, organization: hq, user: bilal, name: "Bilal", employeeCode: "E2", department: media, status: "active", joiningDate: g("2025-02-01") },
  { _id: eCara, organization: hq, user: cara, name: "Cara", employeeCode: "E3", department: sales, status: "active", joiningDate: g("2025-03-01") },
  { _id: eDana, organization: hq, name: "Dana", employeeCode: "E4", department: sales, status: "probation", joiningDate: g("2026-09-14"), employmentType: "full_time" },
  { _id: eXan, organization: hq, name: "Xan", employeeCode: "E5", department: media, status: "terminated", joiningDate: g("2024-01-01") },
  { _id: id(), organization: hq, name: "Eli", employeeCode: "E6", department: media, status: "resigned", joiningDate: g("2026-08-01") },
  { _id: id(), organization: blr, user: ravi, name: "Ravi", employeeCode: "B1", department: null, status: "active", joiningDate: g("2025-01-01") },
]);

const att = (user: mongoose.Types.ObjectId, day: string, status: string, worked = 0, late = 0, org: unknown = hq) =>
  ({ organization: org, user, date: g(day, "00:00"), localDay: day, status, workedMinutes: worked, lateMinutes: late, checkIn: g(day, "09:00") });
await ins("attendances", [
  att(asha, "2026-09-01", "present", 480), att(asha, "2026-09-02", "late", 460, 20), att(asha, "2026-09-03", "absent"), att(asha, "2026-09-05", "weekend"),
  att(bilal, "2026-09-01", "wfh", 420), att(bilal, "2026-09-02", "half_day", 240), att(bilal, "2026-09-03", "early_out", 300), att(bilal, "2026-09-04", "on_leave"),
  att(cara, "2026-08-31", "present", 480), att(cara, "2026-10-01", "present", 480),
  att(cara, "2026-09-05", "present", 480, 0, null), // from before organizations: HQ's
  att(ravi, "2026-09-01", "present", 480, 0, blr),
]);
await ins("leaverequests", [
  { organization: hq, user: asha, type: "annual", days: 2, startDate: g("2026-09-10", "00:00"), endDate: g("2026-09-11", "00:00"), status: "approved" },
  { organization: hq, user: asha, type: "sick", days: 1, startDate: g("2026-09-12", "00:00"), endDate: g("2026-09-12", "00:00"), status: "rejected" },
  { organization: hq, user: bilal, type: "annual", days: 3, startDate: g("2026-09-20", "00:00"), endDate: g("2026-09-22", "00:00"), status: "approved" },
  { organization: hq, user: cara, type: "casual", days: 1, startDate: g("2026-09-25", "00:00"), endDate: g("2026-09-25", "00:00"), status: "pending" },
  { organization: hq, user: bilal, type: "annual", days: 1, startDate: g("2026-10-02", "00:00"), endDate: g("2026-10-02", "00:00"), status: "approved" },
]);
await ins("regularizations", [
  { organization: hq, user: bilal, type: "missing_checkin", date: g("2026-09-04"), status: "pending", escalated: true, createdAt: g("2026-09-05") },
  { organization: hq, user: cara, type: "wrong_time", date: g("2026-09-05"), status: "approved", createdAt: g("2026-09-06") },
  { organization: hq, user: asha, type: "early_checkout", date: g("2026-08-19"), status: "rejected", createdAt: g("2026-08-20") },
]);
const r1 = id(), r2 = id(), r3 = id();
await ins("jobrequisitions", [
  { _id: r1, organization: hq, title: "Video editor", type: "new_headcount", department: media, headcount: 2, raisedBy: bilal, status: "approved", createdAt: g("2026-09-03") },
  { _id: r2, organization: hq, title: "Sales exec", type: "replacement", department: sales, headcount: 1, raisedBy: asha, status: "rejected", createdAt: g("2026-09-08") },
  { _id: r3, organization: hq, title: "Closer", type: "new_headcount", department: sales, headcount: 1, raisedBy: asha, status: "filled", createdAt: g("2026-08-15") },
]);
const zed = id(), yan = id(), wes = id();
await ins("candidates", [{ _id: zed, name: "Zed" }, { _id: yan, name: "Yan" }, { _id: wes, name: "Wes" }]);
await ins("applications", [
  { organization: hq, requisition: r1, candidate: zed, stage: "interview", status: "active", createdAt: g("2026-09-04") },
  { organization: hq, requisition: r1, candidate: yan, stage: "hired", status: "active", createdAt: g("2026-08-25"),
    offer: { sentAt: g("2026-09-10"), signedAt: g("2026-09-12") }, stageHistory: [{ stage: "offer", at: g("2026-09-10") }, { stage: "hired", at: g("2026-09-20") }] },
  { organization: hq, requisition: r3, candidate: wes, stage: "screening", status: "rejected", createdAt: g("2026-09-15") },
]);
await ins("resignations", [
  { organization: hq, employee: eBilal, user: bilal, resignationType: "resignation", resignationDate: g("2026-09-05"), lastWorkingDay: g("2026-10-05"), status: "accepted" },
  { organization: hq, employee: eXan, resignationType: "termination", resignationDate: g("2026-09-18"), lastWorkingDay: g("2026-09-18"), status: "relieved" },
  { organization: hq, employee: eCara, user: cara, resignationType: "resignation", resignationDate: g("2026-07-01"), lastWorkingDay: g("2026-09-30"), status: "relieved" },
]);
await ins("payrollbatches", [
  { organization: hq, month: "2026-09", monthDate: g("2026-09-01"), currency: "AED", status: "paid", employeeCount: 4, grossTotal: 100000, deductionTotal: 10000, netTotal: 90000, submittedBy: asha, paidAt: g("2026-10-01") },
  { organization: hq, month: "2026-08", monthDate: g("2026-08-01"), currency: "AED", status: "paid", employeeCount: 4, grossTotal: 1, deductionTotal: 0, netTotal: 1 },
  { organization: hq, month: "2026-10", monthDate: g("2026-10-01"), currency: "AED", status: "draft", employeeCount: 4, grossTotal: 1, deductionTotal: 0, netTotal: 1 },
  { organization: blr, month: "2026-09", monthDate: g("2026-09-01"), currency: "INR", status: "approved", employeeCount: 1, grossTotal: 550000, deductionTotal: 50000, netTotal: 500000 },
]);
await ins("procurements", [
  { organization: hq, item: "Laptop", category: "it", quantity: 1, estimatedCost: 5000, department: sales, requestedBy: asha, status: "approved", createdAt: g("2026-09-02") },
  { organization: hq, item: "Chair", category: "furniture", quantity: 2, estimatedCost: 800, department: media, requestedBy: bilal, status: "rejected", createdAt: g("2026-09-03") },
  { organization: hq, item: "Monitor", category: "it", quantity: 1, estimatedCost: 1200, department: sales, requestedBy: cara, status: "received", createdAt: g("2026-09-04") },
  { organization: hq, item: "Old", category: "it", quantity: 1, estimatedCost: 9999, requestedBy: cara, status: "received", createdAt: g("2026-08-01") },
]);
await ins("officekeepingrequests", [
  { organization: hq, issue: "AC leaking", location: "Floor 2", requestedBy: asha, handledBy: bilal, status: "sorted", createdAt: g("2026-09-05") },
  { organization: hq, issue: "Bulb", location: "Pantry", requestedBy: bilal, status: "requested", createdAt: g("2026-09-06") },
]);
await ins("overtimes", [
  { organization: hq, employee: eAsha, user: asha, date: g("2026-09-10"), hours: 3, hourlyRate: 66.67, amount: 300, month: "2026-09", applied: true },
  { organization: hq, employee: eBilal, user: bilal, date: g("2026-08-30"), hours: 5, hourlyRate: 10, amount: 50, month: "2026-08" },
]);
await ins("reimbursements", [
  { organization: hq, employee: eCara, user: cara, category: "travel", title: "Taxi", amount: 250, expenseDate: g("2026-09-11"), month: "2026-09", status: "approved" },
  { organization: hq, employee: eBilal, user: bilal, category: "food", title: "Lunch", amount: 50, expenseDate: g("2026-09-12"), month: "2026-09", status: "rejected" },
  { organization: hq, employee: eAsha, user: asha, category: "food", title: "Dinner", amount: 100, expenseDate: g("2026-09-13"), month: "2026-09", status: "paid" },
]);

const r = (await hrmsReportForPortal({ from: FROM, to: TO })) as any;
check("the report", typeof r === "object", String(r));
same("the first organization by default, every one offered with its currency", [r.org.name, r.organizations.map((o: any) => `${o.name}:${o.currency}`)], ["Delta HQ", ["Delta HQ:AED", "Delta Bangalore:INR"]]);
const P = (sec: any, name: string) => sec.people.find((p: any) => p.name === name);
const T = (sec: any, team: string) => sec.teams.find((t: any) => t.team === team);

step("Attendance");
const a = r.attendance.total;
same("working days 6 (weekend, August, October, Bangalore left out; the one with no organization counted)", a.days, 6);
same("present 2, late 1 (20 min), absent 1, half day 1, WFH 1, early out 1, on leave 1",
  [a.present, a.late, a.late_minutes, a.absent, a.half_day, a.wfh, a.early_out, a.on_leave], [2, 1, 20, 1, 1, 1, 1, 1]);
same("worked minutes", a.worked_minutes, 2380);
same("by department: Sales 3 days, Media 3", [T(r.attendance, "Sales")?.days, T(r.attendance, "Media")?.days], [3, 3]);
same("Asha: 2 days, late once, absent once", [P(r.attendance, "Asha")?.days, P(r.attendance, "Asha")?.late, P(r.attendance, "Asha")?.absent], [2, 1, 1]);
same("the list: only the days to look at (late, absent, half day, early out)", r.attendance.rows.map((x: any) => x.status).sort(), ["absent", "early_out", "half_day", "late"]);

step("Leave");
const l = r.leave.total;
same("starting in September: 4 requests, 2 approved, 1 rejected, 1 pending, 5 days taken", [l.requests, l.approved, l.rejected, l.pending, l.days], [4, 2, 1, 1, 5]);
same("by type: annual 5 days", r.leave.types, [{ name: "annual", count: 5 }]);
same("Bilal 3 days, Asha 2", [P(r.leave, "Bilal")?.days, P(r.leave, "Asha")?.days], [3, 2]);

step("Regularization");
const g2 = r.regularization.total;
same("raised in September: 2, approved 1, pending 1, escalated 1", [g2.requests, g2.approved, g2.pending, g2.escalated], [2, 1, 1, 1]);
same("by type", r.regularization.types.map((x: any) => x.name).sort(), ["missing checkin", "wrong time"]);

step("Hiring");
const h = r.hiring.total;
same("requisitions 2 (headcount 3), approved 1, rejected 1", [h.requisitions, h.headcount, h.approved, h.rejected, h.filled], [2, 3, 1, 1, 0]);
same("candidates applying 2, offers sent 1 and signed 1, hired 1 (applied in August)", [h.applications, h.offers_sent, h.offers_signed, h.hired], [2, 1, 1, 1]);
same("candidates by where they stand", r.hiring.stages.map((x: any) => `${x.name}:${x.count}`).sort(), ["interview:1", "rejected:1"]);
same("Media: the video editor's 2 and its hire", [T(r.hiring, "Media")?.headcount, T(r.hiring, "Media")?.hired], [2, 1]);

step("Joiners and leavers");
const pp = r.people.total;
same("joined 1 (Dana); exits 2 — a resignation and a termination; relieved 2 (by last day)", [pp.joined, pp.exits, pp.resignations, pp.terminations, pp.relieved], [1, 2, 1, 1, 2]);
same("headcount now: Sales 3, Media 1 (the terminated and resigned left out)", r.people.headcount, [{ name: "Sales", count: 3 }, { name: "Media", count: 1 }]);

step("Payroll");
const pr = r.payroll.total;
same("September's run only: 4 employees, gross 100,000, deductions 10,000, net 90,000, paid", [pr.runs, pr.employees, pr.gross, pr.deductions, pr.net, pr.paid], [1, 4, 100000, 10000, 90000, 90000]);
same("the row says who sent it and when it was paid", [r.payroll.rows[0]?.submitted_by, r.payroll.rows[0]?.status, !!r.payroll.rows[0]?.paid_at], ["Asha", "paid", true]);

step("Purchase and office-keeping requests");
const q = r.requests.total;
same("purchases 3 (cost 7,000), approved 2, rejected 1, received 1; office 2, sorted 1", [q.purchases, q.cost, q.approved, q.rejected, q.received, q.office, q.sorted], [3, 7000, 2, 1, 1, 2, 1]);
same("by category", r.requests.categories.map((x: any) => `${x.name}:${x.count}`).sort(), ["furniture:1", "it:2"]);

step("Overtime and reimbursements");
const c = r.claims.total;
same("overtime 3 h / 300; claims 3 (400), approved 350, rejected 1", [c.overtime_hours, c.overtime_amount, c.claims, c.claimed, c.approved, c.rejected], [3, 300, 3, 400, 350, 1]);

step("Another organization, its own currency");
const b = (await hrmsReportForPortal({ org: String(blr), from: FROM, to: TO })) as any;
same("Bangalore in INR: its one attendance day and its own payroll", [b.org.currency, b.attendance.total.days, b.payroll.total.net, b.leave.total.requests], ["INR", 1, 500000, 0]);

step("Errors");
same("an unknown organization", await hrmsReportForPortal({ org: String(id()) }), "No such organization");
same("a bad date", await hrmsReportForPortal({ from: "soon" }), "from / to must be dates");
same("from after to", await hrmsReportForPortal({ from: TO, to: FROM }), "from is after to");
const all = (await hrmsReportForPortal({})) as any;
check("no period: everything (October's attendance too)", all.attendance.total.days === 8, String(all.attendance?.total?.days));

step("The route");
{
  const express = (await import("express")).default;
  const portalRoutes = (await import("../routes/portalRoutes.js")).default;
  const app = express();
  app.use(express.json());
  app.use("/api/v1/service", portalRoutes);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const get = async (qs: string, secret?: string) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/service/hrms-report${qs}`, { headers: secret ? { "x-portal-secret": secret } : {} });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  same("no secret: 401", (await get("")).status, 401);
  same("a wrong secret: 401", (await get("", "x".repeat(SECRET.length))).status, 401);
  const ok = await get(`?from=${FROM}&to=${TO}`, SECRET);
  same("with the secret: 200, the same report", [ok.status, ok.body?.data?.payroll?.total?.net], [200, 90000]);
  same("a bad date: 400 with why", [(await get("?from=soon", SECRET)).status], [400]);
  server.close();
}

await mongoose.connection.dropDatabase();
await mongoose.disconnect();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
