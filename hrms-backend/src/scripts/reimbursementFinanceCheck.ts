/**
 * Checks the finance step on reimbursement claims (REIMBURSEMENT_FINANCE_STEP) on a scratch database: off, HR's
 * approval is final and the payslip pays the claim, as before; on, HR's approval leaves it hr_approved — locked, out of
 * the payslip — and finance's three signed integration routes (list, approve = paid, reject) decide it, including the
 * wrong state, the wrong organization, a changed amount, a refusal with no reason and a retry. Refuses anything but a
 * local scratch database.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hrms-reimb-scratch \
 *   JWT_SECRET=<32+ chars> JWT_REFRESH_SECRET=<32+ chars> \
 *   SUPER_ADMIN_EMAIL=sa@e2e.test SUPER_ADMIN_PASSWORD=x \
 *   INTEGRATION_CLIENT_ID=delta-finance INTEGRATION_SECRET=<32+ chars> \
 *   DOTENV_CONFIG_PATH=/nonexistent bun --no-env-file src/scripts/reimbursementFinanceCheck.ts
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

// Notifications fire a web push; a checkout without web-push installed would fail on import. Nothing here pushes.
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
const { ReimbursementService, computeReimbursements } = await import("../services/reimbursementService.js");
const { adapterFor } = await import("../services/approvalRegistry.js");
const { runWithOrg } = await import("../utils/orgContext.js");
const { signRequest } = await import("../utils/signing.js");
const { Organization } = await import("../models/Organization.js");
const { Role } = await import("../models/Role.js");
const { User } = await import("../models/User.js");
const { Employee } = await import("../models/Employee.js");
const { Department } = await import("../models/Department.js");
const { Reimbursement } = await import("../models/Reimbursement.js");
const { ApprovalWorkflow } = await import("../models/ApprovalWorkflow.js");
const { Notification } = await import("../models/Notification.js");
const express = (await import("express")).default;
const integrationRoutes = (await import("../routes/integrationRoutes.js")).default;

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}${ok ? "" : ` — ${detail}`}`);
};
const setSwitch = (v: string) => { (env as { REIMBURSEMENT_FINANCE_STEP: string }).REIMBURSEMENT_FINANCE_STEP = v; };
const inOrg = <T>(orgId: unknown, fn: () => Promise<T>) =>
  new Promise<T>((resolve, reject) => runWithOrg({ orgId: String(orgId), isSuperAdmin: false }, () => { fn().then(resolve, reject); }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as { statusCode?: number; message?: string }; } };

await mongoose.connect(uri);
const models = [Organization, Role, User, Employee, Department, Reimbursement, ApprovalWorkflow, Notification] as unknown as mongoose.Model<unknown>[];
for (const m of models) await m.collection.deleteMany({});

const id = () => new mongoose.Types.ObjectId();
const orgA = id(), orgB = id();
await Organization.collection.insertMany([{ _id: orgA, name: "Org A", code: "ORGA" }, { _id: orgB, name: "Org B", code: "ORGB" }]);
const hrRole = { _id: id(), roleName: "HR", isSystemRole: false, organization: null, permissions: { reimbursements: { view: true, approve: true } } };
const staffRole = { _id: id(), roleName: "Staff", isSystemRole: false, organization: null, permissions: {} };
await Role.collection.insertMany([hrRole, staffRole]);
const hr = { _id: id(), name: "Hana HR", email: "hr@e2e.test", role: hrRole._id, organization: orgA, status: "active", password: "x" };
const staff = { _id: id(), name: "Sami Staff", email: "staff@e2e.test", role: staffRole._id, organization: orgA, status: "active", password: "x" };
const staffB = { _id: id(), name: "Bina B", email: "b@e2e.test", role: staffRole._id, organization: orgB, status: "active", password: "x" };
await User.collection.insertMany([hr, staff, staffB]);
const dept = id();
await Department.collection.insertOne({ _id: dept, name: "Sales", organization: orgA, coLeaders: [] });
const emp = { _id: id(), name: "Sami Staff", employeeCode: "EMP-014", designation: "Agent", organization: orgA, department: dept, user: staff._id, currency: "AED" };
const empB = { _id: id(), name: "Bina B", employeeCode: "BLR-007", designation: "Agent", organization: orgB, user: staffB._id, currency: "INR" };
await Employee.collection.insertMany([emp, empB]);

const svc = new ReimbursementService();
const reviewer = { _id: String(hrRole._id), roleName: "HR", isSystemRole: false };
const file = (orgId: unknown, userId: unknown, title: string, amount: number) => inOrg(orgId, () =>
  svc.create({ category: title.startsWith("Lunch") ? "food" : "travel", title, amount, expenseDate: new Date("2026-11-12"), month: "2026-11", receiptUrl: `https://files.e2e.test/${title.replace(/\W+/g, "-")}.jpg` } as never,
    { createdBy: String(userId), subjectUserId: String(userId), canApproveOthers: false }));
const hrReview = (orgId: unknown, claimId: unknown, status: "approved" | "rejected", note?: string) =>
  inOrg(orgId, () => svc.review(String(claimId), { status, reviewNote: note } as never, String(hr._id), reviewer));
const statusOf = async (claimId: unknown) => (await Reimbursement.findById(claimId).lean())?.status;

// ── Off: as before ────────────────────────────────────────────────────────────
console.log("Step off");
setSwitch("");
const offClaim = await file(orgA, staff._id, "Taxi, step off", 40);
await hrReview(orgA, offClaim!._id, "approved");
check("HR's approval is final: approved", (await statusOf(offClaim!._id)) === "approved");
const offPay = await inOrg(orgA, () => computeReimbursements(String(emp._id), "2026-11"));
check("…and the payslip pays it", offPay.ids.includes(String(offClaim!._id)), JSON.stringify(offPay));
setSwitch("yes");
const yesClaim = await file(orgA, staff._id, "Taxi, step yes", 41);
await hrReview(orgA, yesClaim!._id, "approved");
check("only the exact value \"on\" counts", (await statusOf(yesClaim!._id)) === "approved");

// ── On: HR passes it to finance ──────────────────────────────────────────────
console.log("\nStep on");
setSwitch("on");
const toPay = await file(orgA, staff._id, "Taxi to client meeting", 85);
const toRefuse = await file(orgA, staff._id, "Lunch with the team", 180);
const hrRefuses = await file(orgA, staff._id, "Taxi HR refuses", 20);
const stillWithHr = await file(orgA, staff._id, "Taxi still with HR", 15);
await hrReview(orgA, toPay!._id, "approved", "Fine");
await hrReview(orgA, toRefuse!._id, "approved");
await hrReview(orgA, hrRefuses!._id, "rejected", "No receipt");
const paidRow = await Reimbursement.findById(toPay!._id).lean();
check("HR's approval: hr_approved, HR's reviewer and time kept",
  paidRow?.status === "hr_approved" && String(paidRow.reviewedBy) === String(hr._id) && !!paidRow.reviewedAt && paidRow.rejectedBy === null,
  JSON.stringify(paidRow));
const hrNo = await Reimbursement.findById(hrRefuses!._id).lean();
check("HR's refusal: rejected, by HR", hrNo?.status === "rejected" && hrNo.rejectedBy === "hr", JSON.stringify(hrNo));
await hrReview(orgA, offClaim!._id, "approved");
check("one approved for the payslip before the step stays approved", (await statusOf(offClaim!._id)) === "approved");
const onPay = await inOrg(orgA, () => computeReimbursements(String(emp._id), "2026-11"));
check("a claim waiting on finance never goes into the payslip",
  !onPay.ids.includes(String(toPay!._id)) && !onPay.ids.includes(String(toRefuse!._id)) && onPay.ids.includes(String(offClaim!._id)),
  JSON.stringify(onPay));
const reReview = await errOf(hrReview(orgA, toPay!._id, "rejected"));
check("HR can't decide it again while finance has it: 409", reReview?.statusCode === 409, JSON.stringify(reReview));
const edit = await errOf(inOrg(orgA, () => svc.update(String(toPay!._id), { amount: 999 } as never)));
check("it can't be edited: 400", edit?.statusCode === 400, JSON.stringify(edit));
const del = await errOf(inOrg(orgA, () => svc.remove(String(toPay!._id))));
check("it can't be deleted: 409", del?.statusCode === 409, JSON.stringify(del));
// The history populates the reviewer, as the approvals page does.
const hrHistory = adapterFor("reimbursement")!.decided.outcome((await Reimbursement.findById(toPay!._id).populate("reviewedBy", "name").lean()) as never);
check("HR's approvals history shows it approved, by HR", hrHistory.outcome === "approved" && hrHistory.by?.name === "Hana HR", JSON.stringify(hrHistory));
const bClaim = await file(orgB, staffB._id, "Fuel for office run", 1200);
await hrReview(orgB, bClaim!._id, "approved");

// ── The routes ──────────────────────────────────────────────────────────────
console.log("\n/integrations/reimbursements/requests");
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
const R = "/reimbursements/requests";

const unsigned = await call("GET", `${R}?${A}`, undefined, false);
check("unsigned: 401", unsigned.status === 401, String(unsigned.status));
const noOrg = await call("GET", R);
check("no organizationId: 400", noOrg.status === 400, String(noOrg.status));
const badStatus = await call("GET", `${R}?${A}&status=pending`);
check("a status finance doesn't read: 400", badStatus.status === 400, String(badStatus.status));

const list = await call("GET", `${R}?${A}`);
const rows = (list.body.data ?? []) as Array<Record<string, any>>;
check("list: 200, org A's two waiting, oldest HR approval first",
  list.status === 200 && rows.map((r) => r.title).join() === "Taxi to client meeting,Lunch with the team",
  `${list.status} ${rows.map((r) => r.title).join()}`);
const KEYS = "_id,title,category,amount,requestedAmount,currency,expenseDate,month,description,receiptUrl,status,employee,user,hrReviewedBy,hrReviewedAt,hrNote,createdAt,rejectedBy,financeRef,paidOn,paymentMethod,financeNote,financeReviewedBy,financeReviewedAt";
check("each row has exactly the contract's fields", rows.every((r) => Object.keys(r).join() === KEYS), Object.keys(rows[0] ?? {}).join());
const row = rows[0] ?? {};
check("the row: amount, currency, dates, receipt, employee and department, HR's approver and note",
  row.amount === 85 && row.currency === "AED" && row.expenseDate === "2026-11-12" && row.month === "2026-11" && row.category === "travel"
    && /Taxi-to-client-meeting\.jpg$/.test(row.receiptUrl) && row.employee?.name === "Sami Staff" && row.employee?.employeeCode === "EMP-014"
    && row.employee?.department?.name === "Sales" && row.user?.email === "staff@e2e.test" && row.hrReviewedBy?.name === "Hana HR"
    && row.hrNote === "Fine" && !!row.hrReviewedAt && row.status === "hr_approved",
  JSON.stringify(row));
const listB = await call("GET", `${R}?${B}`);
check("org B's list: only org B's, in its employee's currency",
  listB.status === 200 && listB.body.data?.length === 1 && listB.body.data[0].title === "Fuel for office run" && listB.body.data[0].currency === "INR",
  JSON.stringify(listB.body.data));

const wrongOrg = await call("POST", `${R}/${toPay!._id}/approve?${B}`, { reference: "EXP-1" });
check("approve in the wrong organization: 404", wrongOrg.status === 404, `${wrongOrg.status} ${wrongOrg.body.message}`);
const badId = await call("POST", `${R}/not-an-id/approve?${A}`, {});
check("approve a malformed id: 404", badId.status === 404, `${badId.status} ${badId.body.message}`);
const pendingTry = await call("POST", `${R}/${stillWithHr!._id}/approve?${A}`, { reference: "EXP-1" });
check("approve one still with HR: 409", pendingTry.status === 409 && /still with HR/.test(String(pendingTry.body.message)), `${pendingTry.status} ${pendingTry.body.message}`);
const payslipTry = await call("POST", `${R}/${offClaim!._id}/approve?${A}`, { reference: "EXP-1" });
check("approve one approved for the payslip: 409", payslipTry.status === 409, `${payslipTry.status} ${payslipTry.body.message}`);
const more = await call("POST", `${R}/${toPay!._id}/approve?${A}`, { reference: "EXP-1", amount: 90 });
check("approve at more than claimed with no note: 400, and it still waits", more.status === 400 && /needs a note/.test(String(more.body.message)) && (await statusOf(toPay!._id)) === "hr_approved", `${more.status} ${more.body.message}`);
const zero = await call("POST", `${R}/${toPay!._id}/approve?${A}`, { reference: "EXP-1", amount: 0 });
check("approve at 0: 400", zero.status === 400 && (await statusOf(toPay!._id)) === "hr_approved", `${zero.status} ${zero.body.message}`);

const ok = await call("POST", `${R}/${toPay!._id}/approve?${A}`, { reference: "EXP-00231", paidOn: "2026-11-16", method: "bank_transfer", amount: 85, note: "Paid with the week's claims", by: "Fatima Finance" });
const okRec = ok.body.data ?? {};
check("approve: 200, paid, with finance's number, date, method, note, name and time",
  ok.status === 200 && okRec.status === "paid" && okRec.financeRef === "EXP-00231" && okRec.paidOn === "2026-11-16" && okRec.paymentMethod === "bank_transfer"
    && okRec.financeNote === "Paid with the week's claims" && okRec.financeReviewedBy === "Fatima Finance" && !!okRec.financeReviewedAt && okRec.rejectedBy === null,
  `${ok.status} ${JSON.stringify(okRec)}`);
const stored = await Reimbursement.findById(toPay!._id).lean();
check("…stored with no payslip", stored?.status === "paid" && !stored.payslip, JSON.stringify(stored));
check("…paid as claimed: amount 85, nothing kept as claimed", okRec.amount === 85 && okRec.requestedAmount === null && stored?.amount === 85 && stored?.requestedAmount == null, JSON.stringify(okRec));
const again = await call("POST", `${R}/${toPay!._id}/approve?${A}`, { reference: "EXP-00231", note: "retry" });
check("approve again (a retry): 200, the first answer unchanged",
  again.status === 200 && again.body.data?.financeReviewedAt === okRec.financeReviewedAt && again.body.data?.financeNote === "Paid with the week's claims",
  `${again.status} ${JSON.stringify(again.body.data)}`);
const flip = await call("POST", `${R}/${toPay!._id}/reject?${A}`, { note: "Changed my mind" });
check("reject one finance paid: 409", flip.status === 409, `${flip.status} ${flip.body.message}`);

const noNote = await call("POST", `${R}/${toRefuse!._id}/reject?${A}`, { by: "Fatima" });
check("reject with no reason: 400", noNote.status === 400, `${noNote.status} ${noNote.body.message}`);
const shortNote = await call("POST", `${R}/${toRefuse!._id}/reject?${A}`, { note: " no ", by: "Fatima" });
check("reject with a 2-character reason: 400, and it still waits", shortNote.status === 400 && (await statusOf(toRefuse!._id)) === "hr_approved", `${shortNote.status} ${shortNote.body.message}`);
const no = await call("POST", `${R}/${toRefuse!._id}/reject?${A}`, { note: "Receipt can't be read", by: "Fatima Finance" });
check("reject: 200, refused by finance, with the reason",
  no.status === 200 && no.body.data?.status === "rejected" && no.body.data?.rejectedBy === "finance"
    && no.body.data?.financeNote === "Receipt can't be read" && !!no.body.data?.financeReviewedAt,
  `${no.status} ${JSON.stringify(no.body.data)}`);
const noAgain = await call("POST", `${R}/${toRefuse!._id}/reject?${A}`, {});
check("reject again (a retry, no reason sent): 200, the first answer", noAgain.status === 200 && noAgain.body.data?.financeNote === "Receipt can't be read", `${noAgain.status} ${noAgain.body.message}`);
const noApprove = await call("POST", `${R}/${toRefuse!._id}/approve?${A}`, {});
check("approve one finance refused: 409", noApprove.status === 409, `${noApprove.status} ${noApprove.body.message}`);
const hrOverturn = await errOf(hrReview(orgA, toRefuse!._id, "approved"));
check("HR can't overturn finance's refusal: 409", hrOverturn?.statusCode === 409, JSON.stringify(hrOverturn));

// ── Another amount than claimed (2026-11-16) ────────────────────────────────
const hotel = await file(orgA, staff._id, "Hotel for the expo", 400);
const parking = await file(orgA, staff._id, "Parking at the venue", 30);
await hrReview(orgA, hotel!._id, "approved");
await hrReview(orgA, parking!._id, "approved");
const less = await call("POST", `${R}/${hotel!._id}/approve?${A}`, { reference: "EXP-00232", paidOn: "2026-11-16", method: "cash", amount: 300, by: "Fatima Finance" });
check("paid less, no note needed: 200, amount 300, 400 kept as claimed",
  less.status === 200 && less.body.data?.status === "paid" && less.body.data?.amount === 300 && less.body.data?.requestedAmount === 400,
  `${less.status} ${JSON.stringify(less.body.data)}`);
const hotelRow = await Reimbursement.findById(hotel!._id).lean();
check("…stored: amount 300, requestedAmount 400", hotelRow?.amount === 300 && hotelRow?.requestedAmount === 400, JSON.stringify(hotelRow));
const lessAgain = await call("POST", `${R}/${hotel!._id}/approve?${A}`, { reference: "EXP-00232", amount: 300 });
check("…a retry: 200, still 300 of 400", lessAgain.status === 200 && lessAgain.body.data?.amount === 300 && lessAgain.body.data?.requestedAmount === 400, JSON.stringify(lessAgain.body.data));
const moreNoNote = await call("POST", `${R}/${parking!._id}/approve?${A}`, { reference: "EXP-00233", amount: 35 });
check("paid more with no note: 400", moreNoNote.status === 400 && (await statusOf(parking!._id)) === "hr_approved", `${moreNoNote.status} ${moreNoNote.body.message}`);
const moreNote = await call("POST", `${R}/${parking!._id}/approve?${A}`, { reference: "EXP-00233", paidOn: "2026-11-16", method: "cash", amount: 35, note: "The ticket was 35 — receipt was cut off" });
check("paid more with a note: 200, amount 35, 30 kept as claimed, the note kept",
  moreNote.status === 200 && moreNote.body.data?.amount === 35 && moreNote.body.data?.requestedAmount === 30 && moreNote.body.data?.financeNote === "The ticket was 35 — receipt was cut off",
  `${moreNote.status} ${JSON.stringify(moreNote.body.data)}`);

const after = await call("GET", `${R}?${A}`);
check("decided ones leave the queue", after.status === 200 && after.body.data?.length === 0, JSON.stringify(after.body.data?.map((r: { title: string }) => r.title)));
const paidList = await call("GET", `${R}?${A}&status=paid`);
const titles = (l: Res) => (l.body.data ?? []).map((r: { title: string }) => r.title).sort().join();
check("status=paid: the three finance paid (not the payslip's)", titles(paidList) === "Hotel for the expo,Parking at the venue,Taxi to client meeting", titles(paidList));
const refusedList = await call("GET", `${R}?${A}&status=rejected`);
check("status=rejected: the one finance refused (not HR's)", refusedList.body.data?.map((r: { title: string }) => r.title).join() === "Lunch with the team", JSON.stringify(refusedList.body.data?.map((r: { title: string }) => r.title)));
const allList = await call("GET", `${R}?${A}&status=all`);
check("status=all: the four that reached finance, newest decision first",
  titles(allList) === "Hotel for the expo,Lunch with the team,Parking at the venue,Taxi to client meeting" && allList.body.data?.[0]?.title === "Parking at the venue",
  JSON.stringify(allList.body.data?.map((r: { title: string }) => r.title)));
check("org B's still waiting", (await statusOf(bClaim!._id)) === "hr_approved");
const later = await inOrg(orgA, () => computeReimbursements(String(emp._id), "2026-11"));
check("the payslip still never takes the finance-paid one", !later.ids.includes(String(toPay!._id)), JSON.stringify(later));

await sleep(300);
const paidNotes = await Notification.find({ user: staff._id, title: "Your reimbursement has been paid" }).lean();
const paidNote = paidNotes.find((n) => /EXP-00231/.test(String(n.body)));
check("the employee is told it was paid — amount, date, method and number",
  !!paidNote && /AED 85\.00/.test(String(paidNote.body)) && /16 Nov 2026/.test(String(paidNote.body)) && /bank transfer/.test(String(paidNote.body)) && !/instead of/.test(String(paidNote.body)),
  JSON.stringify(paidNotes));
const lessNote = paidNotes.find((n) => /EXP-00232/.test(String(n.body)));
check("…and, paid less, what was paid instead of what was claimed",
  !!lessNote && /AED 300\.00, instead of the AED 400\.00 you claimed/.test(String(lessNote.body)), JSON.stringify(lessNote));
check("…one notice per claim paid, a retry adds none", paidNotes.length === 3, String(paidNotes.length));
const refusedNote = await Notification.findOne({ user: staff._id, title: /not approved by finance/ }).lean();
check("the employee is told finance refused, and why", !!refusedNote && /Receipt can't be read/.test(String(refusedNote.body)), JSON.stringify(refusedNote));
const finHistory = adapterFor("reimbursement")!.decided.outcome((await Reimbursement.findById(toRefuse!._id).lean()) as never);
check("HR's approvals history: still HR's approval, though finance refused it", finHistory.outcome === "approved", JSON.stringify(finHistory));

server.close();
await mongoose.disconnect();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
