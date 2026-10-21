/**
 * Checks finance's view of one-time payments over the signed integration route
 * (GET /integrations/one-time-payments/requests) on a scratch database: with no
 * status it is the queue finance acts on, as before (sent to finance, waiting);
 * with ?status=paid|rejected|all it is finance's full record (2026-10-21) —
 * newest first, this organization only, only those paid through finance, with
 * the employee, department, who raised it and finance's decision. A status it
 * doesn't know is a 400. Refuses anything but a local scratch database.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hrms-onetime-scratch \
 *   JWT_SECRET=<32+ chars> JWT_REFRESH_SECRET=<32+ chars> \
 *   SUPER_ADMIN_EMAIL=sa@e2e.test SUPER_ADMIN_PASSWORD=x \
 *   INTEGRATION_CLIENT_ID=delta-finance INTEGRATION_SECRET=<32+ chars> \
 *   DOTENV_CONFIG_PATH=/nonexistent bun --no-env-file src/scripts/oneTimeHistoryCheck.ts
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
const { OneTimeAdjustment } = await import("../models/OneTimeAdjustment.js");
const express = (await import("express")).default;
const integrationRoutes = (await import("../routes/integrationRoutes.js")).default;

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}${ok ? "" : ` — ${detail}`}`);
};
const j = (v: unknown) => JSON.stringify(v);

await mongoose.connect(uri);
for (const m of [Organization, User, Employee, Department, OneTimeAdjustment] as unknown as mongoose.Model<unknown>[]) await m.collection.deleteMany({});

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
const payment = async (who: { u: { _id: unknown }; e: { _id: unknown } }, x: Record<string, unknown>, org = orgA) => {
  const _id = id();
  await OneTimeAdjustment.collection.insertOne({
    _id, organization: org, employee: who.e._id, user: who.u._id, kind: "payment", label: "Bonus", amount: 500, month: "2026-10", notes: "",
    source: "hr", payVia: "finance", financeStatus: "with_finance", paidOn: null, paymentMethod: "", paymentRef: "", financeNote: "",
    financeDecidedAt: null, applied: false, createdBy: hr._id, createdAt: day(1), updatedAt: day(1), ...x,
  });
  return String(_id);
};

const ashik = await person("Ashik"), libin = await person("Libin"), sana = await person("Sana"), omar = await person("Omar");
const other = await person("Otto", orgB);
const waiting = await payment(ashik, { label: "Annual leave settlement", amount: 5133.3, createdAt: day(20) });
const waiting2 = await payment(libin, { label: "Travel allowance for annual leave", amount: 1300, createdAt: day(21) });
const paid = await payment(sana, { financeStatus: "paid", amount: 2000, createdAt: day(9), paidOn: day(12), paymentMethod: "bank_transfer", paymentRef: "TRX-77", financeDecidedAt: day(12), applied: true });
const refused = await payment(omar, { financeStatus: "rejected", amount: 700, createdAt: day(15), financeNote: "Not agreed", financeDecidedAt: day(16) });
// On a payslip, never finance's.
await payment(omar, { payVia: "payslip", financeStatus: null, createdAt: day(19) });
await payment(other, { financeStatus: "paid", createdAt: day(19) }, orgB);

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
let r = await call(`/one-time-payments/requests?${A}`);
check("no status: only what waits on finance, oldest first", r.status === 200 && j(ids(r)) === j([waiting, waiting2]), j(ids(r)));
const w = r.body.data?.[0];
check("…with the employee, department and who raised it", w?.employee?.name === "Ashik" && w?.employee?.department?.name === "Sales" && w?.createdBy?.name === "Hana HR", j(w));
r = await call(`/one-time-payments/requests?${A}&status=with_finance`);
check("status=with_finance: the same queue", j(ids(r)) === j([waiting, waiting2]), j(ids(r)));

console.log("\nFinance's full record");
r = await call(`/one-time-payments/requests?${A}&status=paid`);
check("paid", j(ids(r)) === j([paid]), j(ids(r)));
const p = r.body.data?.[0];
check("…with paid on, method, reference", !!p?.paidOn && p?.paymentMethod === "bank_transfer" && p?.paymentRef === "TRX-77" && p?.financeStatus === "paid", j(p));
r = await call(`/one-time-payments/requests?${A}&status=rejected`);
check("rejected, with finance's note", j(ids(r)) === j([refused]) && r.body.data?.[0]?.financeNote === "Not agreed", j(r.body.data));
r = await call(`/one-time-payments/requests?${A}&status=all`);
check("all: every one sent to finance, newest first", j(ids(r)) === j([waiting2, waiting, refused, paid]), j(ids(r)));
check("…never a payslip one, nor another organization's", !(r.body.data ?? []).some((x) => x.payVia === "payslip" || x.employee?.name === "Otto"));

console.log("\nRefusals");
r = await call(`/one-time-payments/requests?${A}&status=approved`);
check("a status it doesn't know: 400", r.status === 400 && /status must be one of/.test(r.body.message ?? ""), j(r));
r = await call(`/one-time-payments/requests?${A}&status=all`, false);
check("unsigned: 401", r.status === 401, String(r.status));

server.close();
await mongoose.disconnect();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
