/**
 * The CRM salary slabs in payroll (2026-11-01: "the salary from the slab in HRMS, LOP calculated on it"), on a scratch
 * database with a stand-in Root:
 *
 *   1. the refresh: Root's people matched to employees by email and kept; one Root has that HRMS doesn't, listed as
 *      unmatched; the month's payslips for them rebuilt — a payslip imported from a salary sheet takes the slab salary
 *      as its Basic and prices its loss of pay off it (a thirtieth a day); a part month (a joiner) keeps the sheet's
 *      share; someone not on the slabs untouched;
 *   2. the salary: resolveSalaryBreakup gives the slab salary as the whole salary (one Basic), the contract's when asked
 *      to ignore it, and the contract's for a month with no slab salary;
 *   3. a second refresh where somebody has left the slabs: their slab salary goes, their payslip is back on the sheet's;
 *      a CRM Root couldn't read keeps what it had;
 *   4. refused: a month with accounts (409); Root not set up (503), unreachable (502), refusing (502).
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hrms-slab-scratch bun --no-env-file src/scripts/crmSlabSalaryCheck.ts
 */
import http from "node:http";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[\w-]*scratch[\w-]*$/.test(uri)) {
  console.error(`Refusing: needs a local scratch database, got ${uri}`);
  process.exit(1);
}
const SECRET = "hrms-slab-check-secret";
const answer: { status: number; people: unknown[]; failures: unknown[] } = { status: 200, people: [], failures: [] };
const asked: Array<{ path: string; secret: unknown }> = [];
const root = http.createServer((req, res) => {
  asked.push({ path: req.url ?? "", secret: req.headers["x-portal-secret"] });
  const send = (code: number, body: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.headers["x-portal-secret"] !== SECRET) return send(401, { success: false, message: "Invalid service credential" });
  if (answer.status !== 200) return send(answer.status, { success: false, message: "Down" });
  send(200, { success: true, message: "ok", data: { month: "2026-10", people: answer.people, failures: answer.failures } });
});
await new Promise<void>((ok) => root.listen(0, "127.0.0.1", ok));
Object.assign(process.env, {
  NODE_ENV: "test", JWT_SECRET: "hrms-slab-check-jwt-secret-long-enough-0123", JWT_REFRESH_SECRET: "hrms-slab-check-refresh-secret-long-enough-01",
  SUPER_ADMIN_EMAIL: "slab-check@example.com", SUPER_ADMIN_PASSWORD: "slab-check-password",
  ROOT_ERP_SECRET: SECRET, ROOT_ERP_API_URL: `http://127.0.0.1:${(root.address() as { port: number }).port}/`,
});

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail: unknown = "") => {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); } else { fail++; console.log(`  \x1b[31m✗ ${label}${detail !== "" ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}\x1b[0m`); }
};
const refused = async (p: Promise<unknown>, status: number, like: RegExp) => { try { await p; return false; } catch (e: any) { return e.statusCode === status && like.test(e.message); } };

await mongoose.connect(uri);
await mongoose.connection.dropDatabase();
const db = mongoose.connection.db!;
const { refreshSlabSalaries, listSlabSalaries } = await import("../services/crmSlabSalaryService.js");
const { resolveSalaryBreakup } = await import("../services/salaryStructureService.js");

const id = () => new mongoose.Types.ObjectId();
const E = { yamini: id(), joiner: id(), office: id(), jerin: id() };
await db.collection("employees").insertMany([
  { _id: E.yamini, name: "Yamini", email: "yamini@test.local", salary: 3000, status: "active" },
  { _id: E.joiner, name: "Abdul", email: "abdul@test.local", salary: 3000, status: "active" },
  { _id: E.office, name: "Office Staff", email: "office@test.local", salary: 3000, status: "active" },
  { _id: E.jerin, name: "Jerin", email: "jerin@test.local", salary: 3500, status: "active" },
]);
const at = new Date("2026-10-31T10:00:00Z");
// Payslips imported from October's salary sheet, as HR loaded them.
const sheet = (emp: mongoose.Types.ObjectId, basic: number, lopDays: number, lop: number) => ({
  _id: id(), employee: emp, month: "2026-10", monthDate: new Date("2026-10-01T00:00:00Z"), currency: "AED", status: "issued",
  imported: { at, basic, lopDays, paidDays: 30 - lopDays, lop, loan: 0, advance: 0, other: 0 },
  earnings: [{ label: "Basic", amount: basic }], deductions: lop ? [{ label: `Loss of Pay (${lopDays}d)`, amount: lop }] : [],
  grossPay: basic, totalDeductions: lop, netPay: basic - lop, lopDays, workingDays: 27, paidDays: 30 - lopDays,
});
const S = { yamini: sheet(E.yamini, 3000, 0.5, 50), joiner: sheet(E.joiner, 1100, 2, 200), office: sheet(E.office, 3000, 1, 100), jerin: sheet(E.jerin, 3500, 1.5, 175) };
await db.collection("payslips").insertMany(Object.values(S));
const slip = async (k: keyof typeof S) => db.collection("payslips").findOne({ _id: S[k]._id }) as Promise<any>;
const line = (s: any, re: RegExp) => [...(s?.earnings ?? []), ...(s?.deductions ?? [])].find((l: any) => re.test(l.label))?.amount;
const officeBefore = JSON.stringify(await slip("office"));

console.log("\n1. The refresh");
answer.people = [
  { crm: "delta", crmName: "Sales CRM", name: "Yamini", email: "YAMINI@test.local", role: "sales", level: "A", salary: 4000, payable: 3300 },
  { crm: "delta", crmName: "Sales CRM", name: "Abdul", email: "abdul@test.local", role: "sales", level: "Base", salary: 2000, payable: 0 },
  { crm: "draw", crmName: "Draw", name: "Jerin", email: "jerin@test.local", role: "sales", level: "E", salary: 2000, payable: 0 },
  { crm: "draw", crmName: "Draw", name: "Not in HRMS", email: "ghost@test.local", role: "sales", level: "Base", salary: 2000, payable: 0 },
];
let r = await refreshSlabSalaries("2026-10", String(id()));
check("Root asked with HRMS's secret, for October", asked.at(-1)?.path === "/api/v1/service/hrms/slab-pay?month=2026-10" && asked.at(-1)?.secret === SECRET, asked.at(-1));
check("3 matched by email (any case), 1 Root has that HRMS doesn't listed, 3 payslips rebuilt", r.matched === 3 && r.unmatched.length === 1 && r.unmatched[0]!.email === "ghost@test.local" && r.payslipsRebuilt === 3, r);
let y = await slip("yamini");
check("Yamini (A): Basic 4,000 in place of the sheet's 3,000; loss of pay 0.5 day off 4,000 = 66.67; net 3,933.33",
  line(y, /^Basic$/) === 4000 && line(y, /^Loss of Pay/) === 66.67 && y.grossPay === 4000 && y.netPay === 3933.33, { e: y.earnings, d: y.deductions, net: y.netPay });
const j = await slip("joiner");
check("Abdul joined mid-month (sheet 1,100 of 3,000): Base 2,000 cut the same → 733.33; 2 days off 2,000 = 133.33",
  line(j, /^Basic$/) === 733.33 && line(j, /^Loss of Pay/) === 133.33, { e: j.earnings, d: j.deductions });
const jr = await slip("jerin");
check("Jerin (E, below his 3,500 contract): Basic 2,000; 1.5 days off 2,000 = 100", line(jr, /^Basic$/) === 2000 && line(jr, /^Loss of Pay/) === 100, { e: jr.earnings, d: jr.deductions });
check("someone not on the slabs: their payslip untouched", JSON.stringify(await slip("office")) === officeBefore);
const listed = await listSlabSalaries("2026-10");
check("the month's slab salaries listed with their employees", listed.rows.length === 3 && listed.rows.every((x) => x.employee) && !!listed.fetchedAt, listed);

console.log("\n2. The salary");
let b = await resolveSalaryBreakup(String(E.yamini), "2026-10", 3000);
check("the slab salary is the whole salary: one Basic of 4,000, named for the slab", b.gross === 4000 && b.earnings.length === 1 && /Salary slab · Sales CRM · A/.test(b.structureName ?? ""), b);
b = await resolveSalaryBreakup(String(E.yamini), "2026-10", 3000, { ignoreSlab: true });
check("…the contract's when asked to ignore it (3,000)", b.gross === 3000, b);
b = await resolveSalaryBreakup(String(E.yamini), "2026-09", 3000);
check("…and the contract's in a month with no slab salary", b.gross === 3000, b);

console.log("\n3. Refreshed again");
answer.people = (answer.people as any[]).filter((p) => p.email !== "abdul@test.local").map((p) => (p.email === "jerin@test.local" ? p : p));
answer.failures = [{ crm: "draw", error: "Its database can't be reached" }];
answer.people = (answer.people as any[]).filter((p) => p.crm !== "draw");
r = await refreshSlabSalaries("2026-10", String(id()));
const j2 = await slip("joiner");
check("Abdul left the slabs: his slab salary gone, his payslip back on the sheet (1,100; 200 off)", r.removed.some((x) => x.email === "abdul@test.local")
  && line(j2, /^Basic$/) === 1100 && line(j2, /^Loss of Pay/) === 200, { removed: r.removed, e: j2.earnings, d: j2.deductions });
check("Draw, which Root couldn't read: Jerin keeps his slab salary (2,000)", line(await slip("jerin"), /^Basic$/) === 2000 && r.crmFailures.length === 1
  && (await listSlabSalaries("2026-10")).rows.some((x) => x.email === "jerin@test.local"));

console.log("\n4. Refused");
await db.collection("payrollbatches").insertOne({ month: "2026-10", status: "in_finance", organization: null });
check("a month with accounts: refused (409), nothing asked of Root", await refused(refreshSlabSalaries("2026-10", String(id())), 409, /is with accounts/));
await db.collection("payrollbatches").updateOne({ month: "2026-10" }, { $set: { status: "returned" } });
answer.status = 503;
check("Root refusing: 502, saying so", await refused(refreshSlabSalaries("2026-10", String(id())), 502, /Root couldn't give the slab salaries/));
answer.status = 200;
const url = process.env.ROOT_ERP_API_URL;
const { env } = await import("../config/env.js");
(env as any).ROOT_ERP_API_URL = "http://127.0.0.1:1";
check("Root unreachable: 502", await refused(refreshSlabSalaries("2026-10", String(id())), 502, /can't be reached/));
(env as any).ROOT_ERP_API_URL = "";
check("Root not set up here: 503, saying what to set", await refused(refreshSlabSalaries("2026-10", String(id())), 503, /ROOT_ERP_API_URL/));
(env as any).ROOT_ERP_API_URL = url;

root.close();
await mongoose.disconnect();
console.log(`\n${fail ? "\x1b[31m" : "\x1b[32m"}${pass}/${pass + fail} checks passed\x1b[0m`);
process.exit(fail ? 1 : 0);
