/**
 * Grant the new `programs` permission to the roles that should have it.
 *
 * A new module is absent from every role document that already exists, and
 * `checkPermission` refuses what it cannot find — so on the day this ships,
 * nobody including HR can open the page, and it looks broken rather than
 * unassigned. Super Admin is unaffected: it bypasses the check entirely.
 *
 * Staff need nothing granted. Booking a place is self-service, on routes that
 * carry no module permission at all, the same as raising leave.
 *
 *     bun src/seeds/grantProgramsAccess.ts            # report only
 *     bun src/seeds/grantProgramsAccess.ts --apply
 *
 * Safe to re-run: a role that already has it is left alone.
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";

/** Who runs staff programs. Anything else is granted by hand, deliberately. */
const FULL = ["HR Manager"];

async function main() {
  const apply = process.argv.includes("--apply");
  await connectDB();
  console.log(`Mode: ${apply ? "APPLY" : "dry run"}\n`);

  const roles = await Role.find({}).lean();
  for (const r of roles) {
    const perms = (r as { permissions?: Record<string, Record<string, boolean>> }).permissions ?? {};
    const users = await User.countDocuments({ role: r._id, status: { $ne: "inactive" } });
    const wanted = FULL.includes(String(r.roleName));
    const has = !!perms.programs;

    if (r.isSystemRole && r.roleName === "Super Admin") {
      console.log(`  ${String(r.roleName).padEnd(26)} ${String(users).padStart(3)} users  — bypasses permissions, nothing to grant`);
      continue;
    }
    if (!wanted) {
      console.log(`  ${String(r.roleName).padEnd(26)} ${String(users).padStart(3)} users  — not granted (booking a place needs no permission)`);
      continue;
    }
    if (has) {
      console.log(`  ${String(r.roleName).padEnd(26)} ${String(users).padStart(3)} users  — already has it`);
      continue;
    }
    console.log(`  ${String(r.roleName).padEnd(26)} ${String(users).padStart(3)} users  → grant view/create/edit/delete`);
    if (apply) {
      await Role.updateOne(
        { _id: r._id },
        { $set: { "permissions.programs": { view: true, create: true, edit: true, delete: true, approve: false, export: false } } }
      );
    }
  }

  if (!apply) console.log("\nDry run — re-run with --apply to grant.");
  else console.log("\nGranted.");
  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
