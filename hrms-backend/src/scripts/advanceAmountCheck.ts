/**
 * Checks finance paying a different amount for a salary advance (2026-11-10), over the signed integration route
 * POST /integrations/advances/requests/:id/approve on a scratch database: the asked amount is kept as
 * requestedAmount, `amount` becomes what was paid, the recovery loan and the payroll deduction follow it, more than
 * asked needs a note, no amount (an older finance) pays what was asked, and a resend changes nothing.
 * Refuses anything but a local scratch database. Run like advanceHistoryCheck.ts.
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

// Nothing here pushes; stand in for web-push when this checkout has none.
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

const { signRequest } = await import("../utils/signing.js");
const { Organization } = await import("../models/Organization.js");
const { User } = await import("../models/User.js");
const { Employee } = await import("../models/Employee.js");
const { SalaryAdvance } = await import("../models/SalaryAdvance.js");
const { Loan } = await import("../models/Loan.js");
const { computeLoanDeductions } = await import("../services/loanService.js");
const express = (await import("express")).default;
const integrationRoutes = (await import("../routes/integrationRoutes.js")).default;

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}${ok ? "" : ` — ${detail}`}`);
};
const j = (v: unknown) => JSON.stringify(v);

await mongoose.connect(uri);
for (const m of [Organization, User, Employee, SalaryAdvance, Loan] as unknown as mongoose.Model<unknown>[]) await m.collection.deleteMany({});

const id = () => new mongoose.Types.ObjectId();
const org = id();
await Organization.collection.insertOne({ _id: org, name: "Org A", code: "ORGA" });
const person = async (name: string) => {
  const u = { _id: id(), name, email: `${name.toLowerCase()}@e2e.test`, organization: org, status: "active", password: "x" };
  const e = { _id: id(), name, email: u.email, employeeCode: `E-${name}`, designation: "Sales", organization: org, status: "active" };
  await User.collection.insertOne(u);
  await Employee.collection.insertOne(e);
  return { u, e };
};
const waiting = async (who: { u: { _id: unknown }; e: { _id: unknown } }, amount: number, months: number) => {
  const _id = id();
  await SalaryAdvance.collection.insertOne({
    _id, organization: org, employee: who.e._id, user: who.u._id, amount, currency: "AED", reason: "Rent", monthlySalary: 3500,
    status: "hr_approved", months, startMonth: "2026-12", hrReviewedBy: null, hrReviewedAt: new Date(), hrNote: "", financeReviewedAt: null,
    financeNote: "", financeRef: "", paidOn: null, paymentMethod: "", rejectedBy: null, loan: null, raisedBy: null, overLimit: false,
    requestedAmount: null, createdAt: new Date(), updatedAt: new Date(),
  });
  return String(_id);
};

const app = express();
app.use(express.json({ verify: (req, _res, buf) => { (req as unknown as { rawBody?: Buffer }).rawBody = buf; } }));
app.use("/api/v1/integrations", integrationRoutes);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

async function pay(advanceId: string, body: Record<string, unknown>): Promise<{ status: number; body: { data?: any; message?: string } }> {
  const url = `/api/v1/integrations/advances/requests/${advanceId}/approve?organizationId=${org}`;
  const raw = JSON.stringify({ organizationId: String(org), reference: "EXP-1", paidOn: "2026-11-10", method: "bank_transfer", ...body });
  const ts = String(Date.now()), nonce = crypto.randomUUID();
  const res = await fetch(origin + url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-delta-client": CLIENT, "x-delta-timestamp": ts, "x-delta-nonce": nonce, "x-delta-signature": signRequest(SECRET, "POST", url, ts, nonce, raw) },
    body: raw,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const stored = async (x: string) => SalaryAdvance.findById(x).lean<any>();
const loanOf = async (x: string) => Loan.findOne({ advance: new mongoose.Types.ObjectId(x) }).lean<any>();

const jerin = await person("Jerin"), dhinesh = await person("Dhinesh"), sam = await person("Sam"), lee = await person("Lee");

console.log("\nPaid less than asked");
const less = await waiting(jerin, 350, 1);
{
  // Finance's queue says requestedAmount (null) on every row — how finance knows this HRMS takes a changed amount.
  const url = `/api/v1/integrations/advances/requests?organizationId=${org}`;
  const ts = String(Date.now()), nonce = crypto.randomUUID();
  const q = await fetch(origin + url, { headers: { "x-delta-client": CLIENT, "x-delta-timestamp": ts, "x-delta-nonce": nonce, "x-delta-signature": signRequest(SECRET, "GET", url, ts, nonce, "") } });
  const rows = ((await q.json()) as { data?: any[] }).data ?? [];
  check("finance's queue carries requestedAmount: null", rows.length === 1 && "requestedAmount" in rows[0] && rows[0].requestedAmount === null, j(rows));
}
let r = await pay(less, { amount: 300 });
let a = await stored(less);
check("paid: amount 300, the 350 asked kept", r.status === 200 && a.status === "approved" && a.amount === 300 && a.requestedAmount === 350, j({ r, a }));
check("…the answer finance reads says 300", r.body.data?.amount === 300 && r.body.data?.requestedAmount === 350, j(r.body.data));
let loan = await loanOf(less);
check("the recovery is 300 over 1 month", loan?.amount === 300 && loan?.monthlyDeduction === 300 && loan?.installments === 1 && /300 paid of AED 350 asked/.test(loan?.notes ?? ""), j(loan));
const ded = await computeLoanDeductions(String(jerin.e._id), "2026-12");
check("payroll takes 300 in December", ded.repayments.reduce((s, x) => s + x.amount, 0) === 300, j(ded));
r = await pay(less, { amount: 300 });
check("a resend: the same answer, no second loan", r.status === 200 && (await Loan.countDocuments({ advance: new mongoose.Types.ObjectId(less) })) === 1 && (await stored(less)).amount === 300, j(r));

console.log("\nOver two months");
const two = await waiting(dhinesh, 1000, 2);
await pay(two, { amount: 800 });
loan = await loanOf(two);
check("800 over HR's 2 months: 400 a month", loan?.amount === 800 && loan?.monthlyDeduction === 400 && loan?.installments === 2, j(loan));

console.log("\nMore than asked");
const more = await waiting(sam, 500, 1);
r = await pay(more, { amount: 600 });
a = await stored(more);
check("refused without a note, nothing paid", r.status === 400 && /needs a note/.test(r.body.message ?? "") && a.status === "hr_approved" && a.amount === 500 && !(await loanOf(more)), j({ r, a }));
r = await pay(more, { amount: 600, note: "Rent went up" });
a = await stored(more);
check("…paid with a note: 600, 500 asked, the note kept", r.status === 200 && a.amount === 600 && a.requestedAmount === 500 && a.financeNote === "Rent went up" && (await loanOf(more))?.amount === 600, j(a));
r = await pay(await waiting(sam, 200, 1), { amount: 0 });
check("an amount of 0 is refused", r.status === 400 && /more than 0/.test(r.body.message ?? ""), j(r));

console.log("\nSame amount or none");
const same = await waiting(lee, 250, 1);
await pay(same, { amount: 250 });
a = await stored(same);
check("the amount asked: nothing marked changed", a.amount === 250 && a.requestedAmount === null && (await loanOf(same))?.amount === 250, j(a));
const none = await waiting(lee, 150, 1);
await pay(none, {});
a = await stored(none);
check("no amount sent (an older finance): pays what was asked", a.status === "approved" && a.amount === 150 && a.requestedAmount === null && (await loanOf(none))?.amount === 150, j(a));

server.close();
await mongoose.disconnect();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
