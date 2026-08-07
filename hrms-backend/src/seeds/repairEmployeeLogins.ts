import "dotenv/config";
import mongoose from "mongoose";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { env } from "../config/env.js";

/**
 * Release employees still pointing at a login that no longer exists.
 *
 * Deleting a user used to leave the reference behind, which locked the employee
 * out of ever getting another one: createLogin read the raw id and refused with
 * "already has a login account", while every read populated the same field to
 * null and offered to create one. Both sides now handle it, but records broken
 * before that fix stay broken until this clears them.
 *
 *   bun src/seeds/repairEmployeeLogins.ts          # report only
 *   bun src/seeds/repairEmployeeLogins.ts --apply  # clear them
 *
 * Deliberately unscoped — it repairs every tenant in one pass, and is safe to
 * re-run: once a reference is cleared there is nothing left to match.
 */
async function main() {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(env.MONGODB_URI);
  console.log(`Connected. Mode: ${apply ? "APPLY" : "dry run"}\n`);

  const linked = await Employee.find({ user: { $ne: null } })
    .select("employeeCode name user organization")
    .lean<Array<{ _id: unknown; employeeCode?: string; name: string; user: unknown; organization?: unknown }>>();

  // One query for every referenced account, rather than one per employee.
  const alive = new Set(
    (await User.find({ _id: { $in: linked.map((e) => e.user) } }).select("_id").lean()).map((u) =>
      String(u._id)
    )
  );
  const broken = linked.filter((e) => !alive.has(String(e.user)));

  console.log(`Employees with a login reference: ${linked.length}`);
  console.log(`Pointing at a deleted account:    ${broken.length}\n`);

  for (const e of broken) {
    console.log(`  ${e.employeeCode ?? "—"}  ${e.name}  → missing user ${String(e.user)}  (org ${String(e.organization ?? "none")})`);
  }

  if (!broken.length) {
    console.log("\nNothing to repair.");
  } else if (!apply) {
    console.log(`\nDry run — re-run with --apply to clear ${broken.length} reference(s).`);
  } else {
    const result = await Employee.updateMany(
      { _id: { $in: broken.map((e) => e._id) } },
      { $set: { user: null } }
    );
    console.log(`\nCleared ${result.modifiedCount} reference(s). Those employees can be given a login again.`);
  }

  await mongoose.connection.close();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.connection.close();
  process.exit(1);
});
