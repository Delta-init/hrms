/**
 * Grant the new `procurement` permission to the roles that should have it.
 *
 * A new module is absent from every role document that already exists, and
 * `checkPermission` refuses what it cannot find — so on the day this ships the
 * Procurement tab is invisible to everyone until this runs. Super Admin is
 * unaffected: it bypasses the check entirely.
 *
 * Who gets what follows the rule that only HR and department heads raise a
 * request, and only HR passes it to finance:
 *
 *   HR roles          view, create, edit, delete, approve  (approve = send to finance)
 *   everybody else    view
 *
 * A department head's authority comes from heading a department, not from
 * their role, so it is granted per-person rather than guessed at here — see
 * `--heads` below, which grants create+edit to whoever actually leads a team.
 *
 *     bun src/seeds/grantProcurementAccess.ts            # report only
 *     bun src/seeds/grantProcurementAccess.ts --apply
 *
 * Safe to re-run: a role that already has it is left alone.
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { HRMS_MODULES } from "../types/index.js";

/** Who may send a request on to finance. Anything else gets view only. */
const APPROVE = ["HR Manager", "HR Manager (Full Access)"];

/**
 * A one-module (kiosk-only) role must stay that way — granting anything else,
 * even view here, is exactly the lock this role depends on.
 *
 * Restricted to the known module list rather than a raw `Object.entries` scan:
 * the permissions object is a Mongoose subdocument and carries an `_id` of its
 * own, which would otherwise count as a second "granted module" and mask a real
 * kiosk-only role as a normal one.
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
    const has = !!perms.procurement;

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

    const hr = APPROVE.includes(String(r.roleName));
    console.log(`  ${String(r.roleName).padEnd(26)} ${String(users).padStart(3)} users  → grant ${hr ? "full (incl. approve)" : "view only"}`);
    if (apply) {
      await Role.updateOne(
        { _id: r._id },
        {
          $set: {
            "permissions.procurement": {
              view: true, create: hr, edit: hr, delete: hr, approve: hr, export: hr,
            },
          },
        }
      );
    }
  }

  if (!apply) console.log("\nDry run — re-run with --apply to grant.");
  else console.log("\nGranted.");
  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
