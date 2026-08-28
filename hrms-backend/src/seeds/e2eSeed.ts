/**
 * Seeds one throwaway organization and hands it to accounts, so the payroll
 * handover can be exercised end to end against a real database.
 *
 * Run against a scratch mongod only. It refuses to start if MONGODB_URI looks
 * like anything but a local throwaway, because the models it writes through are
 * the same ones production uses and there is no undo.
 *
 * Prints a JSON block on the last line for the finance-side driver to read.
 */
import mongoose from "mongoose";
import { Organization } from "../models/Organization.js";
import { Department } from "../models/Department.js";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { Role } from "../models/Role.js";
import { Payslip } from "../models/Payslip.js";
import { PayrollBatch } from "../models/PayrollBatch.js";
import { OneTimeAdjustment } from "../models/OneTimeAdjustment.js";
// Registered because the payslip service populates through them; without the
// import Mongoose has never seen the schema and the populate throws.
import "../models/WorkSchedule.js";
import "../models/Attendance.js";
import "../models/LeaveRequest.js";
import "../models/Holiday.js";
import "../models/AttendancePenaltyPolicy.js";
import "../models/Loan.js";
import "../models/Reimbursement.js";
import "../models/Overtime.js";
import "../models/SalaryStructure.js";
import "../models/SalaryStructureAssignment.js";
import { PayslipService } from "../services/payslipService.js";
import { payrollBatchService } from "../services/payrollBatchService.js";
import { runWithOrg } from "../utils/orgContext.js";

const MONTH = process.env.E2E_MONTH ?? "2026-03";
const uri = process.env.MONGODB_URI ?? "";

if (!/127\.0\.0\.1|localhost/.test(uri) || !/e2e|test/i.test(uri)) {
  console.error(`Refusing to seed: MONGODB_URI must be a local test database, got "${uri}"`);
  process.exit(1);
}

const payslips = new PayslipService();
const log = (m: string) => console.error(`  hrms: ${m}`);

async function main() {
  await mongoose.connect(uri);
  // A clean slate every run, so a rerun is not testing yesterday's leftovers.
  await mongoose.connection.dropDatabase();

  const org = await Organization.create({
    name: "Delta International Management Development Training",
    code: `E2E${Date.now().toString().slice(-6)}`,
    settings: { currency: "AED", timeZone: "Asia/Dubai" },
  });
  const orgId = String(org._id);
  log(`organization ${org.name}`);

  await runWithOrg({ orgId, isSuperAdmin: false }, () => {});

  const sales = await Department.create({ organization: orgId, name: "Sales", code: "SAL" });
  const ops = await Department.create({ organization: orgId, name: "Operations", code: "OPS" });

  const role = await Role.create({
    roleName: "E2E HR", isSystemRole: false, organization: orgId,
    permissions: { payroll: { view: true, create: true, edit: true, delete: true, approve: true, export: true } },
  });
  const hrUser = await User.create({
    name: "E2E HR", email: `hr.${Date.now()}@e2e.local`, password: "Password123!",
    role: role._id, organization: orgId, status: "active",
  });

  // Three people, chosen to cover the cases that behave differently:
  //  - a salesperson who will earn commission,
  //  - somebody ordinary,
  //  - somebody with no bank details, who must end up held and never paid.
  const people = [
    { employeeCode: "E2E001", name: "Aisha Rahman", department: sales._id, salary: 12000, banked: true },
    { employeeCode: "E2E002", name: "Marcus Fry", department: ops._id, salary: 8000, banked: true },
    { employeeCode: "E2E003", name: "Nadia Okafor", department: ops._id, salary: 9500, banked: false },
  ];

  const staffRole = await Role.create({
    roleName: "E2E Staff", isSystemRole: false, organization: orgId, permissions: {},
  });

  const created: Array<{ id: string; code: string; name: string; email: string }> = [];
  for (const p of people) {
    const email = `${p.employeeCode.toLowerCase()}@e2e.local`;
    // A linked login is not optional for a realistic payslip: summary() returns
    // early without one, and every attendance-derived figure comes back zero.
    const login = await User.create({
      name: p.name, email, password: "Password123!", role: staffRole._id,
      organization: orgId, status: "active",
    });
    const emp = await Employee.create({
      user: login._id,
      organization: orgId,
      employeeCode: p.employeeCode,
      name: p.name,
      email,
      department: p.department,
      designation: "Consultant",
      salary: p.salary,
      currency: "AED",
      status: "active",
      joiningDate: new Date("2024-01-15"),
      bank: p.banked
        ? { bankAccountNumber: `00${p.employeeCode}`, ibanIfsc: `AE07033123456789012${p.employeeCode.slice(-1)}`, bankName: "Emirates NBD", nameInBank: p.name }
        : undefined,
    });
    created.push({ id: String(emp._id), code: p.employeeCode, name: p.name, email });
    log(`employee ${p.employeeCode} ${p.name}${p.banked ? "" : " (no bank details)"}`);
  }

  // A pending one-time deduction larger than one month can absorb, so the
  // recovery allocator's carry-forward is exercised rather than assumed.
  await OneTimeAdjustment.create({
    organization: orgId, employee: created[1]!.id, kind: "deduction",
    label: "Advance recovery", amount: 20000, month: MONTH, applied: false, appliedAmount: 0,
  });
  log("one-time deduction of 20,000 against a salary of 8,000 (must carry forward)");

  await new Promise<void>((resolve, reject) => {
    runWithOrg({ orgId, isSuperAdmin: false }, () => {
      (async () => {
        // runGenerate is what the payroll screen calls. Going through create()
        // directly would skip the salary-structure earnings it supplies, and
        // produce payslips of zero — which is exactly what it did first time.
        const gen = await payslips.runGenerate(MONTH, String(hrUser._id));
        log(`generated ${gen.created} payslips for ${MONTH} (${gen.skipped} skipped)`);

        const pre = await payrollBatchService.preflight(MONTH);
        log(`preflight: canSubmit=${pre.canSubmit} blockers=${pre.blockers.length} warnings=${pre.warnings.length}`);
        for (const w of pre.warnings) log(`  warning: ${w}`);
        if (!pre.canSubmit) throw new Error(`Preflight refused: ${pre.blockers.join(" ")}`);

        await payrollBatchService.submit(MONTH, String(hrUser._id));
        log(`submitted ${MONTH} to accounts`);

        // The lock is the point of step one, so it is verified here rather than
        // assumed: an edit after submit must be refused.
        const slip = await Payslip.findOne({ organization: orgId, month: MONTH });
        let locked = false;
        try {
          await payslips.update(String(slip!._id), { notes: "should not be allowed" } as never, String(hrUser._id));
        } catch {
          locked = true;
        }
        if (!locked) throw new Error("LOCK FAILED: a payslip was editable after the month was submitted");
        log("lock verified: payslips refuse edits once submitted");

        const batch = await PayrollBatch.findOne({ organization: orgId, month: MONTH }).lean();
        console.log(JSON.stringify({
          orgId, month: MONTH, batchStatus: batch?.status,
          netTotal: batch?.netTotal, employeeCount: batch?.employeeCount,
          employees: created,
        }));
        resolve();
      })().catch(reject);
    });
  });

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(`  hrms: FAILED — ${(err as Error).message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
