/**
 * Checks pendingOverview (GET /service/pending, for the Root portal's Pending
 * page) on a scratch database: kind totals equal the sidebar's badges, each
 * request counts against whoever it waits on, every active holder of a role
 * sees the whole of a shared queue, and the route refuses a missing or wrong
 * secret. Refuses anything but a local scratch database.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hrms-pending-scratch ROOT_ERP_SECRET=<anything> \
 *     bun --no-env-file src/scripts/pendingOverviewCheck.ts
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

const { pendingOverview } = await import("../services/pendingOverviewService.js");
const { ApprovalInboxService, SYSTEM_SCOPE } = await import("../services/approvalInboxService.js");
const { LeaveService } = await import("../services/leaveService.js");
const { RegularizationService } = await import("../services/regularizationService.js");
const { Organization } = await import("../models/Organization.js");
const { Role } = await import("../models/Role.js");
const { User } = await import("../models/User.js");
const { Employee } = await import("../models/Employee.js");
const { Department } = await import("../models/Department.js");
const { LeaveRequest } = await import("../models/LeaveRequest.js");
const { Regularization } = await import("../models/Regularization.js");
const { Reimbursement } = await import("../models/Reimbursement.js");
const { Confirmation } = await import("../models/Confirmation.js");
const { JobRequisition } = await import("../models/JobRequisition.js");
const { Application } = await import("../models/Application.js");
const { Resignation } = await import("../models/Resignation.js");
const { SignedAgreement } = await import("../models/SignedAgreement.js");
const express = (await import("express")).default;
const portalRoutes = (await import("../routes/portalRoutes.js")).default;

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}${ok ? "" : ` — ${detail}`}`);
};

await mongoose.connect(uri);
const models = [Organization, Role, User, Employee, Department, LeaveRequest, Regularization, Reimbursement,
  Confirmation, JobRequisition, Application, Resignation, SignedAgreement] as unknown as mongoose.Model<unknown>[];
for (const m of models) await m.collection.deleteMany({});

const id = () => new mongoose.Types.ObjectId();
const DAY = 86_400_000, now = Date.now();
const ago = (days: number) => new Date(now - days * DAY);

const orgA = id(), orgB = id();
await Organization.collection.insertMany([{ _id: orgA, name: "Org A" }, { _id: orgB, name: "Org B" }]);

const approve = { view: true, approve: true };
const role = {
  sa: id(), hr: id(), finance: id(), hrB: id(), staff: id(),
};
await Role.collection.insertMany([
  { _id: role.sa, roleName: "Super Admin", isSystemRole: true, organization: null, permissions: {} },
  // Built-in, so every organisation can use it.
  { _id: role.hr, roleName: "HR", isSystemRole: false, organization: null, permissions: {
    leave: approve, regularization: approve, reimbursements: approve, confirmations: approve,
    resignations: approve, employees: approve, hiring: approve,
  } },
  // Only ever a workflow step: approves nothing on its own.
  { _id: role.finance, roleName: "Finance", isSystemRole: false, organization: orgA, permissions: {} },
  // Org B's own, approving leave and nothing else.
  { _id: role.hrB, roleName: "HR B", isSystemRole: false, organization: orgB, permissions: { leave: approve } },
  { _id: role.staff, roleName: "Staff", isSystemRole: false, organization: null, permissions: { leave: { view: true } } },
]);

const mk = (key: string, r: mongoose.Types.ObjectId, org: mongoose.Types.ObjectId | null, status = "active") =>
  ({ _id: id(), name: key, email: `${key.toUpperCase()}@E2E.test`.toLowerCase(), role: r, organization: org, status, password: "x" });
const u = {
  sa: mk("sa", role.sa, null),
  hr1: mk("hr1", role.hr, orgA),
  hr2: mk("hr2", role.hr, orgA),
  hr3: mk("hr3", role.hr, orgA, "inactive"),
  fin: mk("fin", role.finance, orgA),
  hrB: mk("hrb", role.hrB, orgB),
  head: mk("head", role.staff, orgA),
  mgr: mk("mgr", role.staff, orgA),
  emp1: mk("emp1", role.staff, orgA),
  emp2: mk("emp2", role.staff, orgA),
  empB: mk("empb", role.staff, orgB),
};
await User.collection.insertMany(Object.values(u));

const sales = id();
const emp = {
  head: { _id: id(), user: u.head._id, name: "head", organization: orgA, department: sales },
  emp1: { _id: id(), user: u.emp1._id, name: "emp1", organization: orgA, department: sales },
  emp2: { _id: id(), user: u.emp2._id, name: "emp2", organization: orgA, department: null },
  empB: { _id: id(), user: u.empB._id, name: "empb", organization: orgB, department: null },
};
await Employee.collection.insertMany(Object.values(emp));
// Head recorded as an Employee, the usual way round.
await Department.collection.insertOne({ _id: sales, name: "Sales", organization: orgA, leader: emp.head._id, leaderKind: "Employee", coLeaders: [] });

const steps = [
  { order: 1, role: role.hr, roleName: "HR" },
  { order: 2, role: role.finance, roleName: "Finance" },
];
const leave = (user: mongoose.Types.ObjectId, org: mongoose.Types.ObjectId, extra: Record<string, unknown> = {}) =>
  ({ _id: id(), user, organization: org, status: "pending", type: "annual", days: 1, createdAt: ago(1), ...extra });
const L = {
  head: leave(u.emp1._id, orgA),                                              // dept head
  hr: leave(u.emp2._id, orgA, { createdAt: ago(10) }),                        // HR, overdue
  wf: leave(u.emp1._id, orgA, { approvalSteps: steps, workflowStep: 2, workflowTotalSteps: 2 }), // Finance step
  orgB: leave(u.empB._id, orgB),                                              // Org B's own HR
  done: leave(u.emp2._id, orgA, { status: "approved" }),                      // not pending
};
await LeaveRequest.collection.insertMany(Object.values(L));

const reg = (user: mongoose.Types.ObjectId, extra: Record<string, unknown> = {}) =>
  ({ _id: id(), user, organization: orgA, status: "pending", type: "missing_checkin", date: ago(2), createdAt: ago(1), ...extra });
await Regularization.collection.insertMany([
  reg(u.emp2._id, { escalated: true, escalatedTo: u.mgr._id, monthlyIndex: 4 }), // manager, by name
  reg(u.emp1._id),                                                                // dept head
  reg(u.emp2._id),                                                                // HR
]);

await Reimbursement.collection.insertMany([
  { _id: id(), user: u.emp2._id, organization: orgA, status: "pending", title: "Taxi", amount: 10, createdAt: ago(1) },
  { _id: id(), user: u.emp2._id, organization: orgA, status: "paid", title: "Old", amount: 5, createdAt: ago(30) },
  // Nobody in Org B may approve a reimbursement, so only a Super Admin can.
  { _id: id(), user: u.empB._id, organization: orgB, status: "pending", title: "Lunch", amount: 7, createdAt: ago(1) },
]);
await Confirmation.collection.insertOne({ _id: id(), employee: emp.emp2._id, organization: orgA, status: "pending", createdAt: ago(8) });
await JobRequisition.collection.insertOne({ _id: id(), title: "Agent", organization: orgA, department: sales, status: "pending", raisedBy: u.head._id, createdAt: ago(1) });
await Application.collection.insertOne({ _id: id(), organization: orgA, offerApproval: { status: "pending", requestedAt: ago(1), requestedBy: u.hr1._id }, createdAt: ago(60) });
await Resignation.collection.insertOne({ _id: id(), employee: emp.emp2._id, organization: orgA, status: "pending", createdAt: ago(1) });
await SignedAgreement.collection.insertOne({ _id: id(), employee: emp.emp2._id, user: u.emp2._id, organization: orgA, status: "pending", signedAt: ago(1) });

// ── The service ─────────────────────────────────────────────────────────────
const { kinds, people } = await pendingOverview();
const summary = await new ApprovalInboxService().summary(SYSTEM_SCOPE);
const kind = (k: string) => kinds.find((x) => x.key === k);
const person = (email: string) => people.find((p) => p.email === email);
const sum = (keys: string[]) => keys.reduce((n, k) => n + (kind(k)?.total ?? 0), 0);

console.log("\nkinds = the sidebar's badges");
check("every kind together = the Approvals badge (summary total)",
  kinds.reduce((n, k) => n + k.total, 0) === summary.total, `${kinds.reduce((n, k) => n + k.total, 0)} vs ${summary.total}`);
check("kinds in sidebar order, Leave and Regularization first",
  kinds.map((k) => k.key).join() === "leave,leave_approvers,regularization,regularization_approvers,hiring_requisitions,offer_releases,signed_agreements,resignations,reimbursements,confirmations",
  kinds.map((k) => k.key).join());
const leaveBadge = await new LeaveService().pendingCount();
check("Leave's two halves = the Leave badge (4)", sum(["leave", "leave_approvers"]) === leaveBadge && leaveBadge === 4, `${sum(["leave", "leave_approvers"])} vs ${leaveBadge}`);
const regBadge = await new RegularizationService().pendingCount();
check("Regularization's two halves = the Regularization badge (3)", sum(["regularization", "regularization_approvers"]) === regBadge && regBadge === 3, `${sum(["regularization", "regularization_approvers"])} vs ${regBadge}`);
for (const [key, module] of [["hiring_requisitions", "hiring"], ["offer_releases", "offer"], ["signed_agreements", "agreement"],
  ["resignations", "resignation"], ["reimbursements", "reimbursement"], ["confirmations", "confirmation"]] as const) {
  const m = summary.byModule.find((x) => x.module === module)!;
  check(`${key} = the inbox's ${module} count (${m.count})`, kind(key)?.total === m.count, `${kind(key)?.total}`);
}
check("paid / approved records are not counted", kind("reimbursements")?.total === 2 && kind("leave_approvers")?.total === 3, JSON.stringify([kind("reimbursements"), kind("leave_approvers")]));
check("overdue = waiting over 7 days (old leave, old confirmation)",
  kind("leave_approvers")?.overdue === 1 && kind("confirmations")?.overdue === 1 && kind("leave")?.overdue === 0,
  JSON.stringify(kinds.map((k) => [k.key, k.overdue])));
check("named halves are not shared; everything else is",
  !kind("leave")?.shared && !kind("regularization")?.shared && kinds.filter((k) => !["leave", "regularization"].includes(k.key)).every((k) => k.shared === true),
  JSON.stringify(kinds.map((k) => [k.key, k.shared])));

console.log("\nwho it waits on");
const c = (email: string) => person(email)?.counts ?? {};
check("department head: their department's leave and correction, by name",
  JSON.stringify(c("head@e2e.test")) === JSON.stringify({ leave: 1, regularization: 1 }), JSON.stringify(c("head@e2e.test")));
check("past the allowance: the reporting manager's, by name", JSON.stringify(c("mgr@e2e.test")) === JSON.stringify({ regularization: 1 }), JSON.stringify(c("mgr@e2e.test")));
check("mid-workflow: the current step's role (Finance), not the head", JSON.stringify(c("fin@e2e.test")) === JSON.stringify({ leave_approvers: 1 }), JSON.stringify(c("fin@e2e.test")));
check("another organisation's leave: its own approvers only", JSON.stringify(c("hrb@e2e.test")) === JSON.stringify({ leave_approvers: 1 }), JSON.stringify(c("hrb@e2e.test")));
check("offers, and a queue nobody in that organisation may approve: Super Admin",
  JSON.stringify(c("sa@e2e.test")) === JSON.stringify({ offer_releases: 1, reimbursements: 1 }), JSON.stringify(c("sa@e2e.test")));
const hrExpected = {
  leave_approvers: 1, leave_approvers_overdue: 1, regularization_approvers: 1, hiring_requisitions: 1,
  signed_agreements: 1, resignations: 1, reimbursements: 1, confirmations: 1, confirmations_overdue: 1,
};
check("shared: HR holder 1 gets every HR item in full", JSON.stringify(c("hr1@e2e.test")) === JSON.stringify(hrExpected), JSON.stringify(c("hr1@e2e.test")));
check("shared: HR holder 2 gets exactly the same", JSON.stringify(c("hr2@e2e.test")) === JSON.stringify(hrExpected), JSON.stringify(c("hr2@e2e.test")));
check("an inactive holder of the role gets nothing", !person("hr3@e2e.test"), JSON.stringify(person("hr3@e2e.test")));
check("requesters with nothing to decide are left out", !person("emp1@e2e.test") && !person("emp2@e2e.test") && !person("empb@e2e.test"));
check("person.total = sum of counts without *_overdue (HR = 7)",
  people.every((p) => p.total === Object.entries(p.counts).filter(([k]) => !k.endsWith("_overdue")).reduce((n, [, v]) => n + v, 0))
    && person("hr1@e2e.test")?.total === 7, JSON.stringify(people.map((p) => [p.email, p.total])));
check("sorted by total, largest first", people.every((p, i) => i === 0 || people[i - 1].total >= p.total), JSON.stringify(people.map((p) => p.total)));
check("shape: id, lowercase email, active flag",
  people.every((p) => mongoose.isValidObjectId(p.id) && p.email === p.email.toLowerCase() && p.active === true),
  JSON.stringify(people[0]));

// ── The route ───────────────────────────────────────────────────────────────
console.log("\nGET /api/v1/service/pending");
const app = express();
app.use(express.json());
app.use("/api/v1/service", portalRoutes);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/service/pending`;
const none = await fetch(base);
check("no secret: 401", none.status === 401, String(none.status));
const wrong = await fetch(base, { headers: { "x-portal-secret": `${SECRET}-wrong` } });
check("wrong secret: 401", wrong.status === 401, String(wrong.status));
const ok = await fetch(base, { headers: { "x-portal-secret": SECRET } });
const body = (await ok.json()) as { success?: boolean; data?: { kinds?: unknown[]; people?: unknown[] } };
check("right secret: 200 with { success, data: { kinds, people } }",
  ok.status === 200 && body.success === true && JSON.stringify(body.data?.kinds) === JSON.stringify(kinds)
    && JSON.stringify(body.data?.people) === JSON.stringify(people),
  `${ok.status} ${JSON.stringify(body).slice(0, 200)}`);
server.close();

await mongoose.disconnect();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
