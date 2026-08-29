/**
 * Remove payslips whose employee no longer exists.
 *
 * An employee used to be deletable while payslips still pointed at them, which
 * left pay records belonging to nobody. They cannot be reached in the
 * application — every payslip screen is opened through an employee — and they
 * block the finance import, which refuses a month it cannot account for.
 *
 * `employeeService.remove` now refuses to delete anybody who has payslips, so
 * no more of these can appear. This clears the ones already there.
 *
 * Deletes pay records, so it lists exactly what it would remove and changes
 * nothing without --apply. Read the list before running it: a payslip for
 * somebody who was actually paid is a record worth keeping, and if any of
 * these were paid the right answer is to recreate the employee instead.
 *
 * Run with:  bun src/scripts/removeOrphanedPayslips.ts [--apply]
 */

import mongoose from "mongoose";
import { env } from "../config/env.js";

const APPLY = process.argv.includes("--apply");

async function run() {
  await mongoose.connect(env.MONGODB_URI);
  const db = mongoose.connection.db!;

  // Every employee id a payslip points at, and which of them still exist.
  const referenced: mongoose.Types.ObjectId[] = await db
    .collection("payslips")
    .distinct("employee");
  const alive = new Set(
    (
      await db
        .collection("employees")
        .find({ _id: { $in: referenced } })
        .project({ _id: 1 })
        .toArray()
    ).map((e) => String(e._id)),
  );
  const gone = referenced.filter((id) => id && !alive.has(String(id)));

  if (gone.length === 0) {
    console.log("No orphaned payslips.");
    await mongoose.disconnect();
    return;
  }

  const slips = await db.collection("payslips").find({ employee: { $in: gone } }).toArray();
  console.log(`${slips.length} payslip(s) belonging to ${gone.length} deleted employee(s):\n`);

  let everPaid = 0;
  for (const p of slips) {
    const paid = p.paidAt ? `PAID ${new Date(p.paidAt).toISOString().slice(0, 10)}` : "never paid";
    if (p.paidAt) everPaid++;
    console.log(`  ${p._id}  month=${p.month}  status=${p.status}  net=${p.netPay ?? 0}  ${paid}`);
  }

  if (everPaid > 0) {
    // Somebody's record of being paid. Deleting it is not a cleanup.
    console.error(
      `\nSTOPPING: ${everPaid} of these were actually paid. Recreate the employee instead — ` +
        `a paid payslip is the record of that payment and should not be deleted.`,
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  if (!APPLY) {
    console.log(`\nDry run — nothing deleted. Re-run with --apply to remove ${slips.length} payslip(s).`);
    await mongoose.disconnect();
    return;
  }

  const res = await db.collection("payslips").deleteMany({ _id: { $in: slips.map((s) => s._id) } });
  console.log(`\nDeleted ${res.deletedCount} payslip(s).`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
