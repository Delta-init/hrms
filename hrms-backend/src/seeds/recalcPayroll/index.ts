import mongoose from "mongoose";
import { env } from "../../config/env.js";
import { Organization } from "../../models/Organization.js";
import { Employee } from "../../models/Employee.js";
// Registered so populate() inside the payslip service can resolve them; the
// service reaches for these through the employee, not by importing them here.
import { WorkSchedule } from "../../models/WorkSchedule.js";
import { Department } from "../../models/Department.js";
import { User } from "../../models/User.js";
void Employee; void WorkSchedule; void Department; void User;
import { Payslip } from "../../models/Payslip.js";
import { PayrollBatch } from "../../models/PayrollBatch.js";
import { PayslipService } from "../../services/payslipService.js";
import { PayrollBatchService } from "../../services/payrollBatchService.js";
import { runWithOrg } from "../../utils/orgContext.js";

/**
 * Rebuild a month's payslips from their sources.
 *
 * Written for one specific accident: `unrecordedDaysUnpaid` was switched on
 * against a register holding seven attendance rows for ninety-nine people, so
 * every working day nobody had punched became unpaid and August went out with
 * eighty-six per cent of gross withheld and forty-six people on nothing at all.
 *
 * The policy is already corrected. This makes the payslips agree with it.
 *
 * A month at "approved" is frozen, and deliberately so — an edit behind
 * finance's back means the money that leaves the bank and the payslip the
 * employee downloads describe two different months. So the batch is moved to
 * "returned" first, which is the state the workflow already has for exactly
 * this, and left there afterwards. Re-approving is finance's call, not this
 * script's.
 *
 * Refuses outright once anything has been paid. Reversing money that has moved
 * is not a recalculation and must not be dressed up as one.
 *
 *   bun src/seeds/recalcPayroll/index.ts --month=2026-08
 *   bun src/seeds/recalcPayroll/index.ts --month=2026-08 --apply
 */

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const APPLY = args.includes("--apply");
const MONTH = arg("month") ?? "2026-08";
const ORG_NAME = arg("org") ?? "Delta International Management Development Training";

const log = (s = "") => console.log(s);
const head = (s: string) => { log(); log(`── ${s} ${"─".repeat(Math.max(0, 58 - s.length))}`); };
const money = (n: number) => Math.round(n).toLocaleString();

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const org = await Organization.findOne({ name: ORG_NAME }).lean();
  if (!org) throw new Error(`No organisation named "${ORG_NAME}"`);
  const orgId = String(org._id);

  log(`Organisation : ${org.name}`);
  log(`Month        : ${MONTH}`);
  log(`Mode         : ${APPLY ? "APPLY — this rewrites payslips" : "DRY RUN — nothing is written"}`);

  const batch = await PayrollBatch.findOne({ organization: org._id, month: MONTH }).lean();
  if (!batch) throw new Error(`No payroll batch for ${MONTH}`);

  const ids = (await Payslip.find({ organization: org._id, month: MONTH }).select("_id").lean()).map((p) => String(p._id));
  const paid = await Payslip.countDocuments({ organization: org._id, month: MONTH, status: "paid" });

  head("Before");
  log(`  batch status        ${batch.status}`);
  log(`  payslips            ${ids.length}`);
  log(`  already paid        ${paid}`);
  if (paid > 0 || batch.status === "paid" || batch.status === "partially_paid") {
    throw new Error("Money has already moved for this month. Reversing a payment is finance's to drive, not this script's.");
  }

  // Totals read one at a time — holding ninety-nine populated payslips and
  // recomputing against them at once exhausts the heap.
  let g0 = 0, n0 = 0, lop0 = 0;
  for (const id of ids) {
    const p = await Payslip.findById(id).select("grossPay netPay lopDays").lean();
    g0 += p?.grossPay ?? 0; n0 += p?.netPay ?? 0; lop0 += p?.lopDays ?? 0;
  }
  log(`  gross               ${money(g0)}`);
  log(`  net                 ${money(n0)}   (${Math.round((1 - n0 / g0) * 100)}% withheld)`);
  log(`  LOP days, total     ${lop0}`);

  const payslips = new PayslipService();
  const batches = new PayrollBatchService();

  // ── What it would become ──────────────────────────────────────────────────
  let lop1 = 0, changes = 0;
  await new Promise<void>((done, fail) => {
    runWithOrg({ orgId, isSuperAdmin: false }, async () => {
      try {
        for (const id of ids) {
          const p = await Payslip.findById(id).select("employee month lopDays").lean();
          if (!p) continue;
          const att = await payslips.summary(String(p.employee), String(p.month));
          lop1 += att.lopDays;
          if ((p.lopDays ?? 0) !== att.lopDays) changes++;
        }
        done();
      } catch (e) { fail(e); }
    });
  });

  head("After recalculation");
  log(`  LOP days, total     ${lop0}  →  ${lop1}`);
  log(`  payslips changing   ${changes} of ${ids.length}`);

  if (!APPLY) {
    head("Nothing was written");
    log(`  re-run with --apply to rebuild them`);
    await mongoose.disconnect();
    return;
  }

  // ── Write ─────────────────────────────────────────────────────────────────
  await new Promise<void>((done, fail) => {
    runWithOrg({ orgId, isSuperAdmin: false }, async () => {
      try {
        if (batch.status !== "returned" && batch.status !== "draft") {
          await batches.transition(MONTH, "returned", {
            actor: "system",
            note: "Recalculated: unrecorded-days-unpaid was applied against an empty attendance register",
          });
          log(`  batch ${batch.status} → returned`);
        }
        let done_ = 0;
        for (const id of ids) {
          await payslips.recompute(id);
          if (++done_ % 25 === 0) log(`  recomputed ${done_} of ${ids.length}`);
        }
        log(`  recomputed ${done_} of ${ids.length}`);
        done();
      } catch (e) { fail(e); }
    });
  });

  let g2 = 0, n2 = 0, lop2 = 0;
  for (const id of ids) {
    const p = await Payslip.findById(id).select("grossPay netPay lopDays").lean();
    g2 += p?.grossPay ?? 0; n2 += p?.netPay ?? 0; lop2 += p?.lopDays ?? 0;
  }
  const after = await PayrollBatch.findOne({ organization: org._id, month: MONTH }).lean();

  head("Applied");
  log(`  batch status        ${after?.status}`);
  log(`  gross               ${money(g0)}  →  ${money(g2)}`);
  log(`  net                 ${money(n0)}  →  ${money(n2)}`);
  log(`  LOP days            ${lop0}  →  ${lop2}`);
  log(`  on nothing at all   ${await Payslip.countDocuments({ organization: org._id, month: MONTH, netPay: { $lte: 0 } })}`);
  log();
  log(`  The batch is at "returned" — corrected but not re-approved.`);
  log(`  Finance sends it back through submitted → in_finance → approved.`);
  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(String(e?.message ?? e)); await mongoose.disconnect(); process.exit(1); });
