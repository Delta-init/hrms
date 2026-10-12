/**
 * Grant the new `advances` permission to the roles that should have it.
 *
 * A new module is absent from every role document that already exists, and
 * `checkPermission` refuses what it cannot find — so until this runs nobody
 * can see the Advances tab or decide an advance. Super Admin is unaffected: it
 * bypasses the check entirely.
 *
 * Asking is self-service and is not gated by this at all — everybody gets
 * view and create so the tab reads the same as the rest of their pay. HR gets
 * `approve`, which is HR's half of the decision; finance decides its half in
 * the finance system, over the integration API, and needs nothing here.
 *
 *     bun src/seeds/grantAdvancesAccess.ts            # report only
 *     bun src/seeds/grantAdvancesAccess.ts --apply
 *
 * Safe to re-run: a role that already has it is left alone.
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { HRMS_MODULES } from "../types/index.js";

/** Who decides these: HR. Finance decides its half in the finance system. */
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
    const has = !!perms.advances;

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
    console.log(`  ${String(r.roleName).padEnd(26)} ${String(users).padStart(3)} users  → grant ${hr ? "view + create + PANEL" : "view + create"}`);
    if (apply) {
      await Role.updateOne(
        { _id: r._id },
        {
          $set: {
            "permissions.advances": {
              view: true, create: true, edit: hr, delete: hr, approve: hr, export: hr,
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
