/**
 * Checks the finance step on hiring requisitions (HIRING_FINANCE_STEP) on a
 * scratch database: off, HR's approval is final as before; on, one that needs
 * accounts waits as finance_pending and the rest are approved; then finance's
 * three signed integration routes — list, approve, reject — including the
 * wrong state, the wrong organization and a refusal with no note. Refuses
 * anything but a local scratch database.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hrms-hiring-scratch \
 *   JWT_SECRET=<32+ chars> JWT_REFRESH_SECRET=<32+ chars> \
 *   SUPER_ADMIN_EMAIL=sa@e2e.test SUPER_ADMIN_PASSWORD=x \
 *   INTEGRATION_CLIENT_ID=delta-finance INTEGRATION_SECRET=<32+ chars> \
 *   DOTENV_CONFIG_PATH=/nonexistent bun --no-env-file src/scripts/hiringFinanceCheck.ts
 */
import mongoose from "mongoose";
import crypto from "node:crypto";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[\w-]*scratch[\w-]*$/.test(uri)) {
  console.error(`Refusing: needs a local scratch database, got ${uri}`);
  process.exit(1);
}
const CLIENT = process.env.INTEGRATION_CLIENT_ID ?? "";
const SECRET = process.env.INTEGRATION_SECRET ?? "";
if (!CLIENT || SECRET.length < 32) {
  console.error("Set INTEGRATION_CLIENT_ID and INTEGRATION_SECRET (32+ chars) so the routes can be exercised");
  process.exit(1);
}

// Notifications fire a web push; a checkout without web-push installed would
// fail on import. Nothing here pushes, so stand in for it when it is missing.
try { Bun.resolveSync("web-push", import.meta.dir); } catch {
  Bun.plugin({
    name: "stub-web-push",
    setup(build) {
      build.module("web-push", () => ({
        exports: { default: { setVapidDetails() {}, async sendNotification() {} } },
        loader: "object",
      }));
    },
  });
}

const { env } = await import("../config/env.js");
const { JobRequisitionService } = await import("../services/jobRequisitionService.js");
const { adapterFor } = await import("../services/approvalRegistry.js");
const { runWithOrg } = await import("../utils/orgContext.js");
const { signRequest } = await import("../utils/signing.js");
const { Organization } = await import("../models/Organization.js");
const { Role } = await import("../models/Role.js");
const { User } = await import("../models/User.js");
const { Employee } = await import("../models/Employee.js");
const { Department } = await import("../models/Department.js");
const { JobRequisition } = await import("../models/JobRequisition.js");
const { ApprovalWorkflow } = await import("../models/ApprovalWorkflow.js");
const { Notification } = await import("../models/Notification.js");
const express = (await import("express")).default;
const integrationRoutes = (await import("../routes/integrationRoutes.js")).default;

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}${ok ? "" : ` — ${detail}`}`);
};
const setSwitch = (v: string) => { (env as { HIRING_FINANCE_STEP: string }).HIRING_FINANCE_STEP = v; };
const inOrg = <T>(orgId: unknown, fn: () => Promise<T>) =>
  new Promise<T>((resolve, reject) => runWithOrg({ orgId: String(orgId), isSuperAdmin: false }, () => { fn().then(resolve, reject); }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await mongoose.connect(uri);
const models = [Organization, Role, User, Employee, Department, JobRequisition, ApprovalWorkflow, Notification] as unknown as mongoose.Model<unknown>[];
for (const m of models) await m.collection.deleteMany({});

const id = () => new mongoose.Types.ObjectId();
const orgA = id(), orgB = id();
await Organization.collection.insertMany([{ _id: orgA, name: "Org A", code: "ORGA" }, { _id: orgB, name: "Org B", code: "ORGB" }]);
const hrRole = { _id: id(), roleName: "HR", isSystemRole: false, organization: null, permissions: { hiring: { view: true, approve: true } } };
const staffRole = { _id: id(), roleName: "Staff", isSystemRole: false, organization: null, permissions: {} };
await Role.collection.insertMany([hrRole, staffRole]);
const hr = { _id: id(), name: "Hana HR", email: "hr@e2e.test", role: hrRole._id, organization: orgA, status: "active", password: "x" };
const head = { _id: id(), name: "Hamid Head", email: "head@e2e.test", role: staffRole._id, organization: orgA, status: "active", password: "x" };
await User.collection.insertMany([hr, head]);
const dept = id();
await Department.collection.insertOne({ _id: dept, name: "Sales", organization: orgA, coLeaders: [] });
const leaver = { _id: id(), name: "Lina Leaver", designation: "Agent", salary: 5000, organization: orgA, department: dept };
await Employee.collection.insertOne(leaver);

const svc = new JobRequisitionService();
const reviewer = { _id: String(hrRole._id), roleName: "HR", isSystemRole: false };
type Doc = { _id: unknown; status: string; budgetApprovalRequired: boolean; rejectedBy?: unknown; financeReviewedAt?: unknown; approvalTrail?: Array<{ action?: string; by?: unknown }> };
const raise = (extra: Record<string, unknown>) => inOrg(orgA, () => svc.create({
  title: "Agent", department: String(dept), employmentType: "full_time", headcount: 1, currency: "AED", type: "new_headcount", ...extra,
} as never, String(head._id))) as Promise<Doc>;
const review = (doc: Doc, status: "approved" | "rejected", note?: string) =>
  inOrg(orgA, () => svc.review(String(doc._id), { status, reviewNote: note }, String(hr._id), reviewer)) as Promise<Doc>;

// ── Switch off ──────────────────────────────────────────────────────────────
console.log("\nHIRING_FINANCE_STEP off");
setSwitch("");
const offBudget = await raise({ title: "New role, off" });
check("a new headcount needs accounts", offBudget.budgetApprovalRequired === true, JSON.stringify(offBudget.budgetApprovalRequired));
const offApproved = await review(offBudget, "approved");
check("HR approves it: approved, as before", offApproved.status === "approved" && !offApproved.financeReviewedAt, offApproved.status);
setSwitch("true");
const notOn = await review(await raise({ title: "New role, 'true'" }), "approved");
check("only the exact value \"on\" counts: \"true\" still approves", notOn.status === "approved", notOn.status);
setSwitch("");
// Raised before the switch, decided after it.
const raisedBefore = await raise({ title: "Raised while off" });

// ── Switch on ───────────────────────────────────────────────────────────────
console.log("\nHIRING_FINANCE_STEP on");
setSwitch("on");
const workflow = await inOrg(orgA, () => svc.workflowState());
check("workflowState says finance decides", workflow.financeStep === true, JSON.stringify(workflow));
const budget = await raise({ title: "New role, on", salaryMin: 4000, salaryMax: 6000, justification: "Growth", jdText: "Sell things" });
const toFinance = await review(budget, "approved", "Fine by HR");
check("budget requisition approved by HR: finance_pending", toFinance.status === "finance_pending", toFinance.status);
check("HR's approval is in the trail, by the HR user",
  toFinance.approvalTrail?.length === 1 && toFinance.approvalTrail[0].action === "approved" && String(toFinance.approvalTrail[0].by) === String(hr._id),
  JSON.stringify(toFinance.approvalTrail));
const backfill = await raise({ title: "Backfill, cheaper", type: "replacement", replacing: String(leaver._id), salaryMax: 4500 });
check("a replacement paid no more than the leaver needs no accounts", backfill.budgetApprovalRequired === false, String(backfill.budgetApprovalRequired));
const backfillOk = await review(backfill, "approved");
check("…and HR's approval stays final: approved", backfillOk.status === "approved", backfillOk.status);
const dearer = await raise({ title: "Backfill, dearer", type: "replacement", replacing: String(leaver._id), salaryMax: 7000 });
const dearerOut = await review(dearer, "approved");
check("a replacement paid more than the leaver: finance_pending", dearerOut.status === "finance_pending", dearerOut.status);
const beforeOut = await review(raisedBefore, "approved");
check("raised while off, approved while on: finance_pending", beforeOut.status === "finance_pending", beforeOut.status);
const hrNo = await review(await raise({ title: "Refused by HR" }), "rejected", "No");
check("HR refusing one: rejected, rejectedBy hr", hrNo.status === "rejected" && hrNo.rejectedBy === "hr", JSON.stringify([hrNo.status, hrNo.rejectedBy]));
const editLocked = await inOrg(orgA, () => svc.update(String(toFinance._id), { title: "x" } as never)).then(() => "edited", (e: Error) => e.message);
check("waiting for finance cannot be edited", /waiting for finance/.test(editLocked), editLocked);
// A configured two-step chain: the first step only advances it; the last
// approval is the one that would have been final, so that is what goes to finance.
const chain = await ApprovalWorkflow.create({ organization: orgA, module: "hiring", enabled: true, steps: [
  { order: 1, role: staffRole._id, label: "Department" }, { order: 2, role: hrRole._id, label: "HR" },
] });
const chained = await raise({ title: "Two-step chain" });
const step1 = await inOrg(orgA, () => svc.review(String(chained._id), { status: "approved" }, String(head._id),
  { _id: String(staffRole._id), roleName: "Staff", isSystemRole: false })) as unknown as Doc;
check("chain step 1 approves: still pending, on to step 2", step1.status === "pending", step1.status);
const step2 = await review(chained, "approved");
check("chain's last step approves: finance_pending", step2.status === "finance_pending" && step2.approvalTrail?.length === 2, JSON.stringify([step2.status, step2.approvalTrail?.length]));
await ApprovalWorkflow.deleteOne({ _id: chain._id });
await JobRequisition.deleteOne({ _id: chained._id });

const waitNote = await Notification.findOne({ user: head._id, title: /waiting for finance/ }).lean();
check("the raiser is told HR approved it and it waits on finance", !!waitNote, "no notification");
const hrDecided = adapterFor("hiring")!.decided.outcome((await JobRequisition.findById(toFinance._id).lean()) as never);
check("HR's approvals history shows it approved, by HR", hrDecided.outcome === "approved", JSON.stringify(hrDecided));

// A JD file on one, so the list carries a signed link.
await JobRequisition.updateOne({ _id: dearerOut._id }, { $set: { jdKey: "org/req/jds/jd.pdf", jdFileName: "jd.pdf" } });
// Org B's own, which org A must never see.
const otherOrg = await JobRequisition.create({ organization: orgB, type: "new_headcount", title: "Org B role", raisedBy: id(), status: "finance_pending", budgetApprovalRequired: true });

// ── The routes ──────────────────────────────────────────────────────────────
console.log("\n/integrations/hiring/requisitions");
const app = express();
app.use(express.json({ verify: (req, _res, buf) => { (req as unknown as { rawBody?: Buffer }).rawBody = buf; } }));
app.use("/api/v1/integrations", integrationRoutes);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

type Res = { status: number; body: { success?: boolean; message?: string; data?: any } };
async function call(method: "GET" | "POST", path: string, body?: unknown, signed = true): Promise<Res> {
  const url = `/api/v1/integrations${path}`;
  const raw = body === undefined ? "" : JSON.stringify(body);
  const ts = String(Date.now()), nonce = crypto.randomUUID();
  const headers: Record<string, string> = body === undefined ? {} : { "content-type": "application/json" };
  if (signed) Object.assign(headers, {
    "x-delta-client": CLIENT, "x-delta-timestamp": ts, "x-delta-nonce": nonce,
    "x-delta-signature": signRequest(SECRET, method, url, ts, nonce, raw),
  });
  const res = await fetch(origin + url, { method, headers, body: body === undefined ? undefined : raw });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const A = `organizationId=${orgA}`, B = `organizationId=${orgB}`;

const unsigned = await call("GET", `/hiring/requisitions?${A}`, undefined, false);
check("unsigned: 401", unsigned.status === 401, String(unsigned.status));
const noOrg = await call("GET", `/hiring/requisitions`);
check("no organizationId: 400", noOrg.status === 400, String(noOrg.status));
const ghostOrg = await call("GET", `/hiring/requisitions?organizationId=${id()}`);
check("an organization that does not exist: 404", ghostOrg.status === 404, String(ghostOrg.status));

const list = await call("GET", `/hiring/requisitions?${A}`);
const rows = (list.body.data ?? []) as Array<Record<string, any>>;
check("list: 200, org A's three waiting, newest first",
  list.status === 200 && rows.map((r) => r.title).join() === "Backfill, dearer,New role, on,Raised while off",
  `${list.status} ${rows.map((r) => r.title).join()}`);
const KEYS = "_id,title,type,headcount,salaryMin,salaryMax,currency,department,designation,location,employmentType,justification,targetStartDate,jdText,jdFileName,jdUrl,raisedBy,replacing,hrApprovedAt,hrApprovedBy,createdAt";
check("each row has exactly the contract's fields", rows.every((r) => Object.keys(r).join() === KEYS), Object.keys(rows[0] ?? {}).join());
const onRow = rows.find((r) => r.title === "New role, on")!;
check("new headcount row: figures, department, raiser, HR approver, no replacing",
  onRow.type === "new_headcount" && onRow.salaryMin === 4000 && onRow.salaryMax === 6000 && onRow.currency === "AED"
    && onRow.department?.name === "Sales" && onRow.raisedBy?.name === "Hamid Head" && onRow.raisedBy?.email === "head@e2e.test"
    && onRow.hrApprovedBy === "Hana HR" && !!onRow.hrApprovedAt && onRow.replacing === null
    && onRow.justification === "Growth" && onRow.jdText === "Sell things" && onRow.jdUrl === "",
  JSON.stringify(onRow));
const dearRow = rows.find((r) => r.title === "Backfill, dearer")!;
check("replacement row: who is replaced, their frozen salary, and a signed JD link",
  dearRow.type === "replacement" && dearRow.replacing?.name === "Lina Leaver" && dearRow.replacing?.designation === "Agent"
    && dearRow.replacing?.salary === 5000 && /\/files\//.test(String(dearRow.jdUrl)) && dearRow.jdFileName === "jd.pdf",
  JSON.stringify(dearRow));
const listB = await call("GET", `/hiring/requisitions?${B}`);
check("org B's list: only org B's", listB.status === 200 && listB.body.data?.length === 1 && listB.body.data[0].title === "Org B role", JSON.stringify(listB.body.data));

const wrongOrg = await call("POST", `/hiring/requisitions/${toFinance._id}/approve?${B}`, { by: "Fatima" });
check("approve in the wrong organization: 404", wrongOrg.status === 404, `${wrongOrg.status} ${wrongOrg.body.message}`);
const badId = await call("POST", `/hiring/requisitions/not-an-id/approve?${A}`, {});
check("approve a malformed id: 404", badId.status === 404, `${badId.status} ${badId.body.message}`);
const notWaiting = await call("POST", `/hiring/requisitions/${backfillOk._id}/approve?${A}`, {});
check("approve one not waiting for finance (approved by HR): 409", notWaiting.status === 409, `${notWaiting.status} ${notWaiting.body.message}`);
const stillPending = await raise({ title: "Still with HR" });
const pendingTry = await call("POST", `/hiring/requisitions/${stillPending._id}/reject?${A}`, { note: "Too dear" });
check("reject one still with HR: 409", pendingTry.status === 409, `${pendingTry.status} ${pendingTry.body.message}`);

const noNote = await call("POST", `/hiring/requisitions/${beforeOut._id}/reject?${A}`, { by: "Fatima" });
check("reject with no note: 400", noNote.status === 400, `${noNote.status} ${noNote.body.message}`);
const shortNote = await call("POST", `/hiring/requisitions/${beforeOut._id}/reject?${A}`, { note: " no ", by: "Fatima" });
check("reject with a 2-character note: 400", shortNote.status === 400, `${shortNote.status} ${shortNote.body.message}`);
check("…and it is still waiting", (await JobRequisition.findById(beforeOut._id).lean())?.status === "finance_pending");

const ok = await call("POST", `/hiring/requisitions/${toFinance._id}/approve?${A}`, { note: "Budgeted in Q4", by: "Fatima Finance" });
const okRec = ok.body.data ?? {};
check("approve: 200, approved, finance's note, name and time",
  ok.status === 200 && okRec.status === "approved" && okRec.financeNote === "Budgeted in Q4" && okRec.financeReviewedBy === "Fatima Finance"
    && !!okRec.financeReviewedAt && okRec.rejectedBy === null && okRec.title === "New role, on",
  `${ok.status} ${JSON.stringify(okRec)}`);
const again = await call("POST", `/hiring/requisitions/${toFinance._id}/approve?${A}`, { note: "retry", by: "Fatima Finance" });
check("approve again (a retry): 200, the first answer unchanged",
  again.status === 200 && again.body.data?.financeReviewedAt === okRec.financeReviewedAt && again.body.data?.financeNote === "Budgeted in Q4",
  `${again.status} ${JSON.stringify(again.body.data)}`);
const flip = await call("POST", `/hiring/requisitions/${toFinance._id}/reject?${A}`, { note: "Changed my mind" });
check("reject one finance already approved: 409", flip.status === 409, `${flip.status} ${flip.body.message}`);

const no = await call("POST", `/hiring/requisitions/${beforeOut._id}/reject?${A}`, { note: "Over the Q4 budget", by: "Fatima Finance" });
check("reject: 200, rejected by finance, with the note",
  no.status === 200 && no.body.data?.status === "rejected" && no.body.data?.rejectedBy === "finance"
    && no.body.data?.financeNote === "Over the Q4 budget" && !!no.body.data?.financeReviewedAt,
  `${no.status} ${JSON.stringify(no.body.data)}`);
const noApprove = await call("POST", `/hiring/requisitions/${beforeOut._id}/approve?${A}`, {});
check("approve one finance refused: 409", noApprove.status === 409, `${noApprove.status} ${noApprove.body.message}`);

const after = await call("GET", `/hiring/requisitions?${A}`);
check("decided ones leave the list", after.body.data?.map((r: { title: string }) => r.title).join() === "Backfill, dearer", JSON.stringify(after.body.data?.map((r: { title: string }) => r.title)));
check("org B's still untouched", (await JobRequisition.findById(otherOrg._id).lean())?.status === "finance_pending");

await sleep(300);
const approvedNote = await Notification.findOne({ user: head._id, title: /approved by finance \(Fatima Finance\)/ }).lean();
const rejectedNote = await Notification.findOne({ user: head._id, title: /rejected by finance/ }).lean();
check("the raiser is told finance approved, and by whom", !!approvedNote, JSON.stringify(await Notification.find({ user: head._id }).select("title").lean()));
check("the raiser is told finance refused, with the note", !!rejectedNote && /Over the Q4 budget/.test(String(rejectedNote.body)), JSON.stringify(rejectedNote));
const hrHeard = await Notification.findOne({ user: hr._id, title: /was approved by finance/ }).lean();
check("whoever decides hiring sees finance's decision in-app", !!hrHeard, JSON.stringify(await Notification.find({ user: hr._id }).select("title").lean()));
const finDecided = adapterFor("hiring")!.decided.outcome((await JobRequisition.findById(beforeOut._id).lean()) as never);
check("approvals history: refused, by finance, with its note",
  finDecided.outcome === "rejected" && /Fatima Finance/.test(finDecided.by?.name ?? "") && finDecided.note === "Over the Q4 budget",
  JSON.stringify(finDecided));

server.close();
await mongoose.disconnect();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
