/**
 * Checks finance's view of salary advances over the signed integration route
 * (GET /integrations/advances/requests) on a scratch database: with no status
 * it is the queue finance acts on, as before (HR-approved only); with
 * ?status=pending|approved|rejected|all it is finance's full record
 * (2026-10-20) — newest first, this organization only, with the employee,
 * department, HR reviewer and finance's decision. A status it doesn't know is
 * a 400. Refuses anything but a local scratch database.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hrms-advance-scratch \
 *   JWT_SECRET=<32+ chars> JWT_REFRESH_SECRET=<32+ chars> \
 *   SUPER_ADMIN_EMAIL=sa@e2e.test SUPER_ADMIN_PASSWORD=x \
 *   INTEGRATION_CLIENT_ID=delta-finance INTEGRATION_SECRET=<32+ chars> \
 *   DOTENV_CONFIG_PATH=/nonexistent bun --no-env-file src/scripts/advanceHistoryCheck.ts
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
const { Department } = await import("../models/Department.js");
const { SalaryAdvance } = await import("../models/SalaryAdvance.js");
const express = (await import("express")).default;
const integrationRoutes = (await import("../routes/integrationRoutes.js")).default;

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}${ok ? "" : ` — ${detail}`}`);
};
const j = (v: unknown) => JSON.stringify(v);

await mongoose.connect(uri);
for (const m of [Organization, User, Employee, Department, SalaryAdvance] as unknown as mongoose.Model<unknown>[]) await m.collection.deleteMany({});

const id = () => new mongoose.Types.ObjectId();
const orgA = id(), orgB = id();
await Organization.collection.insertMany([{ _id: orgA, name: "Org A", code: "ORGA" }, { _id: orgB, name: "Org B", code: "ORGB" }]);
const sales = { _id: id(), name: "Sales", organization: orgA };
await Department.collection.insertOne(sales);
const hr = { _id: id(), name: "Hana HR", email: "hr@e2e.test", organization: orgA, status: "active", password: "x" };
await User.collection.insertOne(hr);
const person = async (name: string, org = orgA) => {
  const u = { _id: id(), name, email: `${name.toLowerCase()}@e2e.test`, organization: org, status: "active", password: "x" };
  const e = { _id: id(), name, email: u.email, employeeCode: `E-${name}`, designation: "Sales", department: sales._id, organization: org, status: "active" };
  await User.collection.insertOne(u);
  await Employee.collection.insertOne(e);
  return { u, e };
};
const day = (n: number) => new Date(Date.UTC(2026, 9, n, 8));
const advance = async (who: { u: { _id: unknown }; e: { _id: unknown } }, x: Record<string, unknown>, org = orgA) => {
  const _id = id();
  await SalaryAdvance.collection.insertOne({
    _id, organization: org, employee: who.e._id, user: who.u._id, amount: 500, currency: "AED", reason: "Rent", monthlySalary: 4000,
    status: "pending", months: null, startMonth: null, hrReviewedBy: null, hrReviewedAt: null, hrNote: "", financeReviewedAt: null,
    financeNote: "", financeRef: "", paidOn: null, paymentMethod: "", rejectedBy: null, loan: null, raisedBy: null, overLimit: false,
    createdAt: day(1), updatedAt: day(1), ...x,
  });
  return String(_id);
};

const anfas = await person("Anfas"), gopika = await person("Gopika"), riswana = await person("Riswana"), wael = await person("Wael"), omar = await person("Omar");
const other = await person("Otto", orgB);
const waiting = await advance(wael, { status: "hr_approved", months: 2, startMonth: "2026-11", hrReviewedBy: hr._id, hrReviewedAt: day(15), createdAt: day(14), neededBy: day(25) });
const withHr = await advance(omar, { status: "pending", createdAt: day(18) });
const paid = await advance(anfas, {
  status: "approved", amount: 1500, months: 3, startMonth: "2026-11", hrReviewedBy: hr._id, hrReviewedAt: day(10), createdAt: day(9),
  financeReviewedAt: day(12), financeRef: "EXP-00018", paidOn: day(12), paymentMethod: "bank_transfer", raisedBy: hr._id,
});
const paid2 = await advance(gopika, { status: "approved", amount: 300, months: 1, startMonth: "2026-11", hrReviewedBy: hr._id, createdAt: day(11), financeRef: "EXP-00019" });
const hrRefused = await advance(riswana, { status: "rejected", amount: 100, rejectedBy: "hr", hrNote: "Already has a loan", hrReviewedBy: hr._id, createdAt: day(16) });
const finRefused = await advance(anfas, { status: "rejected", amount: 900, rejectedBy: "finance", financeNote: "Over budget", hrReviewedBy: hr._id, createdAt: day(5) });
await advance(other, { status: "approved", createdAt: day(19) }, orgB);

const app = express();
app.use(express.json({ verify: (req, _res, buf) => { (req as unknown as { rawBody?: Buffer }).rawBody = buf; } }));
app.use("/api/v1/integrations", integrationRoutes);
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

async function call(path: string, signed = true): Promise<{ status: number; body: { data?: any[]; message?: string } }> {
  const url = `/api/v1/integrations${path}`;
  const ts = String(Date.now()), nonce = crypto.randomUUID();
  const headers: Record<string, string> = signed
    ? { "x-delta-client": CLIENT, "x-delta-timestamp": ts, "x-delta-nonce": nonce, "x-delta-signature": signRequest(SECRET, "GET", url, ts, nonce, "") }
    : {};
  const res = await fetch(origin + url, { headers });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const A = `organizationId=${orgA}`;
const ids = (r: { body: { data?: any[] } }) => (r.body.data ?? []).map((x) => String(x._id));

console.log("\nThe queue, as before");
let r = await call(`/advances/requests?${A}`);
check("no status: only what waits on finance (HR-approved)", r.status === 200 && j(ids(r)) === j([waiting]), j(ids(r)));
const w = r.body.data?.[0];
check("…with the employee, department and HR reviewer", w?.employee?.name === "Wael" && w?.employee?.department?.name === "Sales" && w?.hrReviewedBy?.name === "Hana HR", j(w));
r = await call(`/advances/requests?${A}&status=hr_approved`);
check("status=hr_approved: the same queue", j(ids(r)) === j([waiting]), j(ids(r)));

console.log("\nFinance's full record");
r = await call(`/advances/requests?${A}&status=pending`);
check("pending: still with HR", j(ids(r)) === j([withHr]), j(ids(r)));
r = await call(`/advances/requests?${A}&status=approved`);
check("approved: paid out, newest first", j(ids(r)) === j([paid2, paid]), j(ids(r)));
const a = r.body.data?.find((x) => String(x._id) === paid);
check("…with finance's reference, paid on, method, the recovery and who raised it",
  a?.financeRef === "EXP-00018" && !!a?.paidOn && a?.paymentMethod === "bank_transfer" && a?.months === 3 && a?.startMonth === "2026-11" && a?.raisedBy?.name === "Hana HR", j(a));
r = await call(`/advances/requests?${A}&status=rejected`);
check("rejected: by HR and by finance, newest first", j(ids(r)) === j([hrRefused, finRefused]), j(ids(r)));
const rj = r.body.data ?? [];
check("…saying who refused it and why", rj[0]?.rejectedBy === "hr" && rj[0]?.hrNote === "Already has a loan" && rj[1]?.rejectedBy === "finance" && rj[1]?.financeNote === "Over budget", j(rj));
r = await call(`/advances/requests?${A}&status=all`);
check("all: every one of this organization's, newest first", j(ids(r)) === j([withHr, hrRefused, waiting, paid2, paid, finRefused]), j(ids(r)));
check("…never another organization's", !(r.body.data ?? []).some((x) => x.employee?.name === "Otto"));

console.log("\nRefusals");
r = await call(`/advances/requests?${A}&status=paid`);
check("a status it doesn't know: 400", r.status === 400 && /status must be one of/.test(r.body.message ?? ""), j(r));
r = await call(`/advances/requests?${A}&status=all`, false);
check("unsigned: 401", r.status === 401, String(r.status));

server.close();
await mongoose.disconnect();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
