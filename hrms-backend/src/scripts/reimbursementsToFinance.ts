/**
 * Send the reimbursement claims HR already approved to finance (the user, 2026-11-16: "reimbursement backfill — it
 * needs to come to finance also").
 *
 * Before REIMBURSEMENT_FINANCE_STEP, HR's approval was final: a claim waited as "approved" for the payslip of its
 * payout month. Those not on any payslip yet become "hr_approved" — Waiting for finance — so they show on finance's
 * Reimbursements page and finance pays them; they then never go into a payslip. HR's approver and time are kept.
 *
 * Left alone: claims still with HR (once the step is on, HR's approval sends them to finance anyway), claims already on
 * a payslip (paid, or on a payslip being paid — never paid twice), refused ones. Nobody is notified: the employee's
 * page says "Waiting for finance".
 *
 * Changes nothing without --apply. Run it where the HRMS .env names the database (hrms-backend):
 *
 *   bun src/scripts/reimbursementsToFinance.ts                              list what it would move
 *   bun src/scripts/reimbursementsToFinance.ts --apply --expect N           move them (refused unless exactly N)
 *   bun src/scripts/reimbursementsToFinance.ts --undo <backup.json>         list what would go back
 *   bun src/scripts/reimbursementsToFinance.ts --undo <backup.json> --apply put back those finance hasn't decided
 *
 * --apply needs REIMBURSEMENT_FINANCE_STEP=on in that .env: finance's side must be live first, or the claims would wait
 * with nobody to pay them. Before moving anything it writes a backup of what it moves (reimbursements-to-finance-
 * <time>.json, in the current folder) and reads it back.
 */
import fs from "node:fs";
import mongoose from "mongoose";
import { env } from "../config/env.js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const valueOf = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const EXPECT = valueOf("--expect");
const UNDO = valueOf("--undo");

type Claim = { _id: mongoose.Types.ObjectId; organization?: unknown; employee?: unknown; title?: string; amount?: number; month?: string; reviewedAt?: Date | null; status?: string; financeReviewedAt?: Date | null };

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

async function describe(db: mongoose.mongo.Db, claims: Claim[]) {
  const orgs = new Map((await db.collection("organizations").find({}, { projection: { name: 1 } }).toArray()).map((o) => [String(o._id), String(o.name ?? "")]));
  const emps = new Map((await db.collection("employees")
    .find({ _id: { $in: claims.map((c) => c.employee).filter(Boolean) as never[] } }, { projection: { name: 1, employeeCode: 1, currency: 1 } })
    .toArray()).map((e) => [String(e._id), e]));
  for (const c of claims) {
    const e = emps.get(String(c.employee));
    console.log(
      `  ${String(c._id)}  ${orgs.get(String(c.organization)) || "—"} · ${e?.employeeCode || "?"} ${e?.name ?? ""} · ${c.title ?? ""} · ` +
      `${String(e?.currency || "AED").toUpperCase()} ${Number(c.amount ?? 0).toFixed(2)} · for ${c.month ?? "?"}` +
      `${c.reviewedAt ? ` · HR approved ${new Date(c.reviewedAt).toISOString().slice(0, 10)}` : ""}`
    );
  }
  const totals = new Map<string, number>();
  for (const c of claims) {
    const cur = String(emps.get(String(c.employee))?.currency || "AED").toUpperCase();
    totals.set(cur, (totals.get(cur) ?? 0) + Number(c.amount ?? 0));
  }
  if (claims.length) console.log(`  In all: ${[...totals].map(([cur, n]) => `${cur} ${n.toFixed(2)}`).join(" + ")}`);
}

async function run() {
  await mongoose.connect(env.MONGODB_URI);
  const db = mongoose.connection.db!;
  const col = db.collection<Claim>("reimbursements");

  // ── Put back ───────────────────────────────────────────────────────────────
  if (UNDO) {
    const saved = JSON.parse(fs.readFileSync(UNDO, "utf8")) as { moved?: Array<{ _id: string }> };
    const ids = (saved.moved ?? []).map((m) => new mongoose.Types.ObjectId(m._id));
    if (!ids.length) fail(`${UNDO} names no claims`);
    // Only those still waiting on finance: one finance paid or refused stays as finance left it.
    const back = await col.find({ _id: { $in: ids }, status: "hr_approved", financeReviewedAt: null }).toArray();
    const decided = ids.length - back.length;
    console.log(`${UNDO}: ${ids.length} moved — ${back.length} still waiting on finance can go back to the payslip${decided ? `, ${decided} finance has decided (or gone) stay` : ""}.`);
    await describe(db, back);
    if (!APPLY) { console.log("\nNothing changed. Add --apply to put them back."); return; }
    const res = await col.updateMany(
      { _id: { $in: back.map((b) => b._id) }, status: "hr_approved", financeReviewedAt: null },
      { $set: { status: "approved", updatedAt: new Date() } }
    );
    console.log(`\n✓ ${res.modifiedCount} put back to "approved" — the payslip of their month pays them again.`);
    return;
  }

  // ── Move ───────────────────────────────────────────────────────────────────
  const filter = { status: "approved", $or: [{ payslip: null }, { payslip: { $exists: false } }] };
  const claims = await col.find(filter).sort({ reviewedAt: 1, createdAt: 1 }).toArray();
  console.log(`Claims HR approved that are on no payslip yet: ${claims.length}`);
  await describe(db, claims);
  const onPayslip = await col.countDocuments({ status: "approved", payslip: { $ne: null } });
  if (onPayslip) console.log(`(${onPayslip} approved and already on a payslip — left as they are.)`);

  if (!APPLY) {
    console.log(`\nNothing changed. To move them: bun src/scripts/reimbursementsToFinance.ts --apply --expect ${claims.length}`);
    return;
  }
  if (env.REIMBURSEMENT_FINANCE_STEP !== "on") {
    fail("REIMBURSEMENT_FINANCE_STEP is not \"on\" in this .env. Deploy finance's side, switch the step on, then run this.");
  }
  if (EXPECT === undefined || Number(EXPECT) !== claims.length) {
    fail(`--expect ${EXPECT ?? "(missing)"} doesn't match the ${claims.length} found. Read the list, then pass --expect ${claims.length}.`);
  }
  if (!claims.length) { console.log("\nNothing to move."); return; }

  const file = `reimbursements-to-finance-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const backup = { at: new Date().toISOString(), moved: claims.map((c) => ({ _id: String(c._id), status: c.status, month: c.month, amount: c.amount })) };
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  const reread = JSON.parse(fs.readFileSync(file, "utf8")) as typeof backup;
  if (reread.moved?.length !== claims.length || reread.moved.some((m, i) => m._id !== String(claims[i]!._id))) {
    fail(`The backup ${file} did not read back whole — nothing changed.`);
  }
  console.log(`\nBackup: ${file}`);

  const res = await col.updateMany(
    { _id: { $in: claims.map((c) => c._id) }, ...filter },
    { $set: { status: "hr_approved", updatedAt: new Date() } }
  );
  const now = await col.countDocuments({ _id: { $in: claims.map((c) => c._id) }, status: "hr_approved" });
  console.log(`✓ ${res.modifiedCount} moved to "Waiting for finance" (${now} of ${claims.length} now waiting on finance).`);
  if (res.modifiedCount !== claims.length) {
    console.log("  Some changed while this ran (put on a payslip, or decided). They were left as they were.");
  }
  console.log(`  To put back any finance hasn't decided: bun src/scripts/reimbursementsToFinance.ts --undo ${file} --apply`);
}

run()
  .catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
