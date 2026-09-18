/**
 * Grant the new `reminders` permission to the roles that should have it.
 *
 * A new module is absent from every role document that already exists, and
 * `checkPermission` refuses what it cannot find — so on the day this ships,
 * nobody sees the Reminders nav item until this runs. Super Admin is
 * unaffected: it bypasses the check entirely.
 *
 * Self/team reminders need nothing granted — creating one is self-service, on
 * a route that carries no module permission at all, the same as raising
 * leave. `view` here only controls whether the nav item and "my reminders"
 * page show up; `approve` is the one flag that actually gates something —
 * sending a reminder to everyone in the org.
 *
 *     bun src/seeds/grantRemindersAccess.ts            # report only
 *     bun src/seeds/grantRemindersAccess.ts --apply
 *
 * Safe to re-run: a role that already has it is left alone.
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { HRMS_MODULES } from "../types/index.js";

/** Who may send a reminder to everyone. Anything else gets view+create only. */
const APPROVE = ["HR Manager", "HR Manager (Full Access)"];

/**
 * A one-module (kiosk-only) role must stay that way — granting anything
 * else, even view+create here, is exactly the lock this role depends on.
 *
 * Restricted to the known module list rather than a raw `Object.entries`
 * scan: the permissions object is a Mongoose subdocument and carries an
 * `_id` of its own, which would otherwise count as a second "granted
 * module" and mask a real kiosk-only role as a normal one.
 */
function isKioskOnly(perms: Record<string, Record<string, unknown> | undefined>): boolean {
  const granted = HRMS_MODULES.filter((mod) => {
    const actions = perms[mod];
    return !!actions && Object.values(actions).some(Boolean);
  });
  return granted.length === 1 && granted[0] === "kiosk";
}

async function main() {
  const apply = process.argv.includes("--apply");
  await connectDB();
  console.log(`Mode: ${apply ? "APPLY" : "dry run"}\n`);

  const roles = await Role.find({}).lean();
  for (const r of roles) {
    const perms = (r as { permissions?: Record<string, Record<string, boolean>> }).permissions ?? {};
    const users = await User.countDocuments({ role: r._id, status: { $ne: "inactive" } });
    const has = !!perms.reminders;

    if (r.isSystemRole && r.roleName === "Super Admin") {
      console.log(`  ${String(r.roleName).padEnd(26)} ${String(users).padStart(3)} users  — bypasses permissions, nothing to grant`);
      continue;
    }
    if (has) {
      console.log(`  ${String(r.roleName).padEnd(26)} ${String(users).padStart(3)} users  — already has it`);
      continue;
    }
    if (isKioskOnly(perms)) {
      console.log(`  ${String(r.roleName).padEnd(26)} ${String(users).padStart(3)} users  — kiosk-only, left alone`);
      continue;
    }
    const approve = APPROVE.includes(String(r.roleName));
    console.log(`  ${String(r.roleName).padEnd(26)} ${String(users).padStart(3)} users  → grant view/create${approve ? "/edit/delete/approve" : ""}`);
    if (apply) {
      await Role.updateOne(
        { _id: r._id },
        { $set: { "permissions.reminders": { view: true, create: true, edit: approve, delete: approve, approve, export: approve } } }
      );
    }
  }

  if (!apply) console.log("\nDry run — re-run with --apply to grant.");
  else console.log("\nGranted.");
  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
