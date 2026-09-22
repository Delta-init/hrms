/**
 * Grant the new `officeKeeping` permission to the roles that should have it.
 *
 * A new module is absent from every role document that already exists, and
 * `checkPermission` refuses what it cannot find — so until this runs the nav
 * item is invisible and the panel unreachable. Super Admin is unaffected: it
 * bypasses the check entirely.
 *
 * Raising a request is ungated at the route, because whoever notices a broken
 * chair should be able to say so; `view` here only decides whether the nav
 * item appears. `approve` is the real gate — it opens the panel and is what
 * lets somebody move a request along.
 *
 * Office keeping is run by the Business Administrator, so the role is named
 * below rather than the person: the panel then follows the job rather than
 * pointing at whoever happened to be doing it the week it was written.
 *
 *     bun src/seeds/grantOfficeKeepingAccess.ts            # report only
 *     bun src/seeds/grantOfficeKeepingAccess.ts --apply
 *
 * Safe to re-run: a role that already has it is left alone.
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { HRMS_MODULES } from "../types/index.js";

/** Who runs office keeping, and HR covering for them. */
const APPROVE = ["HR Manager", "HR Manager (Full Access)", "business administration"];

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
    const has = !!perms.officeKeeping;

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
            "permissions.officeKeeping": {
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
