/**
 * The salary figures on a handover line (2026-11-01: finance puts salespeople on their CRM salary slab), on a scratch
 * database: each payslip's contract salary for the month and how much of it the payslip pays —
 *
 *   1. plain salary, with a one-time payment on the payslip that isn't salary;
 *   2. a raise in force (an increment) and a part month from a salary sheet;
 *   3. a salary structure (Basic + an allowance), with overtime that isn't salary;
 *   4. a payslip whose employee record is gone.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hrms-handover-scratch bun --no-env-file src/scripts/handoverSalaryCheck.ts
 */
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[\w-]*scratch[\w-]*$/.test(uri)) {
  console.error(`Refusing: needs a local scratch database, got ${uri}`);
  process.exit(1);
}
Object.assign(process.env, {
  NODE_ENV: "test", JWT_SECRET: "hrms-handover-check-jwt-secret-long-enough-0", JWT_REFRESH_SECRET: "hrms-handover-check-refresh-secret-long-enough",
  SUPER_ADMIN_EMAIL: "handover-check@example.com", SUPER_ADMIN_PASSWORD: "handover-check-password",
});

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail: unknown = "") => {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); } else { fail++; console.log(`  \x1b[31m✗ ${label}${detail !== "" ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ""}\x1b[0m`); }
};

await mongoose.connect(uri);
await mongoose.connection.dropDatabase();
const db = mongoose.connection.db!;
const { PayrollHandoverService } = await import("../services/payrollHandoverService.js");

const id = () => new mongoose.Types.ObjectId();
const org = id();
const E = { plain: id(), raised: id(), structured: id(), gone: id() };
await db.collection("employees").insertMany([
  { _id: E.plain, organization: org, name: "Plain", employeeCode: "E1", salary: 3000, status: "active" },
  { _id: E.raised, organization: org, name: "Raised", employeeCode: "E2", salary: 3000, status: "active" },
  { _id: E.structured, organization: org, name: "Structured", employeeCode: "E3", salary: 1500, status: "active" },
]);
await db.collection("salaryincrements").insertOne({ organization: org, employee: E.raised, previousSalary: 3000, newSalary: 3500, effectiveMonth: "2026-09" });
const structure = id();
await db.collection("salarystructures").insertOne({ _id: structure, organization: org, name: "Sales", status: "active", components: [{ name: "Housing", type: "earning", calc: "fixed", value: 1000 }] });
await db.collection("salarystructureassignments").insertOne({ organization: org, employee: E.structured, structure, basicAmount: 2000, effectiveMonth: "2026-01" });

const slip = (employee: mongoose.Types.ObjectId, earnings: Array<{ label: string; amount: number }>) => {
  const gross = earnings.reduce((t, l) => t + l.amount, 0);
  return { _id: id(), organization: org, employee, month: "2026-10", currency: "AED", status: "issued", earnings, deductions: [], grossPay: gross, totalDeductions: 0, netPay: gross };
};
await db.collection("payslips").insertMany([
  slip(E.plain, [{ label: "Basic", amount: 3000 }, { label: "Referral bonus", amount: 500 }]),
  slip(E.raised, [{ label: "Basic", amount: 1100 }]),
  slip(E.structured, [{ label: "Basic", amount: 2000 }, { label: "Housing", amount: 1000 }, { label: "Overtime (4h)", amount: 200 }]),
  slip(E.gone, [{ label: "Basic", amount: 900 }]),
]);
await db.collection("payrollbatches").insertOne({ organization: org, month: "2026-10", status: "in_finance", currency: "AED", employeeCount: 4 });

const batch = await new PayrollHandoverService().getBatch(String(org), "2026-10");
const of = (e: mongoose.Types.ObjectId) => batch.lines.find((l) => l.employeeId === String(e))?.salary;
console.log("\nThe salary on each line");
check("plain salary: 3,000 a month, 3,000 paid — the 500 bonus isn't salary", JSON.stringify(of(E.plain)) === JSON.stringify({ monthly: 3000, paid: 3000 }), of(E.plain));
check("a raise to 3,500 in force, a part month off the sheet: 3,500 a month, 1,100 paid", JSON.stringify(of(E.raised)) === JSON.stringify({ monthly: 3500, paid: 1100 }), of(E.raised));
check("a structure (Basic 2,000 + Housing 1,000): 3,000 a month, 3,000 paid — overtime isn't salary", JSON.stringify(of(E.structured)) === JSON.stringify({ monthly: 3000, paid: 3000 }), of(E.structured));
check("an employee record that's gone: 0 and 0", JSON.stringify(of(E.gone)) === JSON.stringify({ monthly: 0, paid: 0 }), of(E.gone));
check("the totals unchanged by it (gross 3,500 + 1,100 + 3,200 + 900)", batch.totals.grossTotal === 8700, batch.totals);

await mongoose.disconnect();
console.log(`\n${fail ? "\x1b[31m" : "\x1b[32m"}${pass}/${pass + fail} checks passed\x1b[0m`);
process.exit(fail ? 1 : 0);
