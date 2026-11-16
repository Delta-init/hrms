/**
 * Checks src/scripts/reimbursementsToFinance.ts on a scratch database: the dry run lists exactly the claims HR approved
 * that are on no payslip and changes nothing; --apply is refused with the step off, without --expect, or with the
 * wrong count; then it moves them to hr_approved (out of the payslip, into finance's queue), writes a backup that reads
 * back, and leaves pending, refused, paid and on-a-payslip claims alone; --undo puts back only those finance hasn't
 * decided. Refuses anything but a local scratch database.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:<port>/hrms-backfill-scratch \
 *   JWT_SECRET=<32+ chars> JWT_REFRESH_SECRET=<32+ chars> \
 *   SUPER_ADMIN_EMAIL=sa@e2e.test SUPER_ADMIN_PASSWORD=x \
 *   DOTENV_CONFIG_PATH=/nonexistent bun --no-env-file src/scripts/reimbursementsToFinanceCheck.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";

const uri = process.env.MONGODB_URI ?? "";
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/[\w-]*scratch[\w-]*$/.test(uri)) {
  console.error(`Refusing: needs a local scratch database, got ${uri}`);
  process.exit(1);
}

// Notifications fire a web push; a checkout without web-push installed would fail on import. Nothing here pushes.
try { Bun.resolveSync("web-push", import.meta.dir); } catch {
  Bun.plugin({
    name: "stub-web-push",
    setup(build) {
      build.module("web-push", () => ({ exports: { default: { setVapidDetails() {}, async sendNotification() {} } }, loader: "object" }));
    },
  });
}

const { computeReimbursements, ReimbursementService } = await import("../services/reimbursementService.js");
const { runWithOrg } = await import("../utils/orgContext.js");
const { Organization } = await import("../models/Organization.js");
const { Employee } = await import("../models/Employee.js");
const { Reimbursement } = await import("../models/Reimbursement.js");

let pass = 0, fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "\x1b[32m✓" : "\x1b[31m✗"}\x1b[0m ${label}${ok ? "" : ` — ${detail}`}`);
};
const inOrg = <T>(orgId: unknown, fn: () => Promise<T>) =>
  new Promise<T>((resolve, reject) => runWithOrg({ orgId: String(orgId), isSuperAdmin: false }, () => { fn().then(resolve, reject); }));

const SCRIPT = path.join(import.meta.dir, "reimbursementsToFinance.ts");
const work = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "reimb-backfill-"));
/** Runs the script as the user would, in `work`, with the step on or off. */
function script(argv: string[], step = "on") {
  const r = Bun.spawnSync(["bun", "--no-env-file", SCRIPT, ...argv], {
    cwd: work,
    env: { ...process.env, REIMBURSEMENT_FINANCE_STEP: step },
  });
  return { code: r.exitCode, out: `${r.stdout.toString()}${r.stderr.toString()}` };
}
const statusOf = async (id: unknown) => (await Reimbursement.findById(id).lean())?.status;

await mongoose.connect(uri);
for (const m of [Organization, Employee, Reimbursement] as unknown as mongoose.Model<unknown>[]) await m.collection.deleteMany({});

const id = () => new mongoose.Types.ObjectId();
const orgA = id(), orgB = id();
await Organization.collection.insertMany([{ _id: orgA, name: "Delta HQ", code: "HQ" }, { _id: orgB, name: "Delta Bangalore", code: "BLR" }]);
const emp = { _id: id(), name: "Sami Staff", employeeCode: "EMP-014", organization: orgA, user: id(), currency: "AED" };
const empB = { _id: id(), name: "Bina B", employeeCode: "BLR-007", organization: orgB, user: id(), currency: "INR" };
await Employee.collection.insertMany([emp, empB]);
const hr = id();
const claim = (x: Record<string, unknown>) => ({
  _id: id(), organization: orgA, employee: emp._id, user: emp.user, category: "travel", title: "Claim", amount: 10, month: "2026-11",
  expenseDate: new Date("2026-11-10"), status: "approved", reviewedBy: hr, reviewedAt: new Date("2026-11-11"), payslip: null,
  createdAt: new Date("2026-11-10"), updatedAt: new Date("2026-11-10"), ...x,
});
const waiting1 = claim({ title: "Taxi to client meeting", amount: 85 });
const waiting2 = claim({ title: "Lunch with the team", category: "food", amount: 180, reviewedAt: new Date("2026-11-09") });
const waitingB = claim({ organization: orgB, employee: empB._id, user: empB.user, title: "Fuel for office run", amount: 1200 });
const noPayslipField = claim({ title: "Old claim, no payslip field", amount: 20 });
delete (noPayslipField as Record<string, unknown>).payslip;
const onPayslip = claim({ title: "On a payslip already", payslip: id() });
const paid = claim({ title: "Paid in October", status: "paid", payslip: id(), month: "2026-10" });
const pending = claim({ title: "Still with HR", status: "pending", reviewedBy: null, reviewedAt: null });
const refused = claim({ title: "Refused by HR", status: "rejected", rejectedBy: "hr" });
await Reimbursement.collection.insertMany([waiting1, waiting2, waitingB, noPayslipField, onPayslip, paid, pending, refused]);
const moving = [waiting2, waiting1, waitingB, noPayslipField];
const before = await inOrg(orgA, () => computeReimbursements(String(emp._id), "2026-11"));
check("before: the payslip would pay the approved claims not on a payslip", [waiting1, waiting2, noPayslipField, onPayslip].every((c) => before.ids.includes(String(c._id))), JSON.stringify(before.ids));

console.log("\nDry run");
const dry = script([]);
check("exits 0, lists the four, with organisation, code, claim, amount and month",
  dry.code === 0 && /no payslip yet: 4/.test(dry.out) && /Delta HQ · EMP-014 Sami Staff · Taxi to client meeting · AED 85\.00 · for 2026-11/.test(dry.out)
    && /Delta Bangalore · BLR-007 Bina B · Fuel for office run · INR 1200\.00/.test(dry.out) && /Old claim, no payslip field/.test(dry.out),
  dry.out);
check("…the total per currency, and the one already on a payslip named as left alone", /In all: AED 285\.00 \+ INR 1200\.00/.test(dry.out) && /1 approved and already on a payslip/.test(dry.out), dry.out);
check("…oldest HR approval first", dry.out.indexOf("Lunch with the team") < dry.out.indexOf("Taxi to client meeting"), dry.out);
check("…and says the command, changing nothing", /--apply --expect 4/.test(dry.out) && (await Promise.all(moving.map((c) => statusOf(c._id)))).every((s) => s === "approved"));

console.log("\nRefusals");
const off = script(["--apply", "--expect", "4"], "");
check("--apply with the step off: refused, nothing changed", off.code === 1 && /REIMBURSEMENT_FINANCE_STEP is not "on"/.test(off.out) && (await statusOf(waiting1._id)) === "approved", off.out);
const noExpect = script(["--apply"]);
check("--apply without --expect: refused", noExpect.code === 1 && /--expect \(missing\)/.test(noExpect.out) && (await statusOf(waiting1._id)) === "approved", noExpect.out);
const wrong = script(["--apply", "--expect", "3"]);
check("--apply with the wrong count: refused", wrong.code === 1 && /doesn't match the 4 found/.test(wrong.out) && (await statusOf(waiting1._id)) === "approved", wrong.out);
check("…and no backup written by a refusal", !fs.readdirSync(work).some((f) => f.startsWith("reimbursements-to-finance-")));

console.log("\nApply");
const run = script(["--apply", "--expect", "4"]);
check("exits 0: 4 moved", run.code === 0 && /✓ 4 moved to "Waiting for finance" \(4 of 4/.test(run.out), run.out);
check("the four are hr_approved", (await Promise.all(moving.map((c) => statusOf(c._id)))).every((s) => s === "hr_approved"));
const kept = await Reimbursement.findById(waiting1._id).lean();
check("…HR's approver and time kept", String(kept?.reviewedBy) === String(hr) && kept?.reviewedAt?.toISOString().slice(0, 10) === "2026-11-11", JSON.stringify(kept));
check("on a payslip, paid, pending and refused: untouched",
  (await statusOf(onPayslip._id)) === "approved" && (await statusOf(paid._id)) === "paid" && (await statusOf(pending._id)) === "pending" && (await statusOf(refused._id)) === "rejected");
const after = await inOrg(orgA, () => computeReimbursements(String(emp._id), "2026-11"));
check("the payslip no longer takes them — only the one already on a payslip's", after.ids.length === 1 && after.ids[0] === String(onPayslip._id), JSON.stringify(after.ids));
const svc = new ReimbursementService();
const queueA = await svc.listForFinance(String(orgA));
const queueB = await svc.listForFinance(String(orgB));
check("finance's queue has them: three in HQ, one in Bangalore in rupees",
  queueA.length === 3 && queueB.length === 1 && queueB[0]!.currency === "INR" && queueA.every((r) => r.hrReviewedAt),
  JSON.stringify([queueA.map((r) => r.title), queueB.map((r) => r.title)]));
const backupFile = fs.readdirSync(work).find((f) => f.startsWith("reimbursements-to-finance-"));
const backup = backupFile ? JSON.parse(fs.readFileSync(path.join(work, backupFile), "utf8")) : null;
check("a backup names the four moved", backup?.moved?.length === 4 && moving.every((c) => backup.moved.some((m: { _id: string }) => m._id === String(c._id))), JSON.stringify(backup));
const again = script(["--apply", "--expect", "0"]);
check("run again: nothing left to move", again.code === 0 && /no payslip yet: 0/.test(again.out) && /Nothing to move/.test(again.out), again.out);

console.log("\nUndo");
// Finance pays one before the undo.
await svc.recordFinanceDecision(String(orgA), String(waiting1._id), { decision: "approve", reference: "EXP-00300", paidOn: "2026-11-17", method: "bank_transfer", amount: 85 });
const undoDry = script(["--undo", backupFile!]);
check("dry: three can go back, the one finance paid stays", undoDry.code === 0 && /4 moved — 3 still waiting on finance can go back/.test(undoDry.out) && /1 finance has decided/.test(undoDry.out) && !/Taxi to client meeting/.test(undoDry.out), undoDry.out);
check("…nothing changed", (await statusOf(waiting2._id)) === "hr_approved");
const undo = script(["--undo", backupFile!, "--apply"]);
check("--apply: three back to approved", undo.code === 0 && /✓ 3 put back/.test(undo.out), undo.out);
check("…the three approved again, the paid one still paid",
  (await statusOf(waiting2._id)) === "approved" && (await statusOf(waitingB._id)) === "approved" && (await statusOf(noPayslipField._id)) === "approved" && (await statusOf(waiting1._id)) === "paid");
const back = await inOrg(orgA, () => computeReimbursements(String(emp._id), "2026-11"));
check("…and the payslip takes them again", back.ids.includes(String(waiting2._id)) && !back.ids.includes(String(waiting1._id)), JSON.stringify(back.ids));

fs.rmSync(work, { recursive: true, force: true });
await mongoose.disconnect();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
