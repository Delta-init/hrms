/**
 * Grant the new `meetings` permission to the roles that should have it.
 *
 * A new module is absent from every role document that already exists, and
 * `checkPermission` refuses what it cannot find — so on the day this ships the
 * Meetings page is invisible to everyone until this runs. Super Admin is
 * unaffected: it bypasses the check entirely.
 *
 * Booking a room is ordinary work rather than a privilege, so every role gets
 * view and create. `edit` governs the rooms themselves — adding a boardroom,
 * retiring one — which is an administrator's job, and who may change somebody
 * else's booking is decided in the service (the organiser, any department head,
 * Super Admin) rather than by a permission.
 *
 *     bun src/seeds/grantMeetingsAccess.ts            # report only
 *     bun src/seeds/grantMeetingsAccess.ts --apply
 *
 * Safe to re-run: a role that already has it is left alone.
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { HRMS_MODULES } from "../types/index.js";

/** Who may add and retire rooms. Everybody else books into them. */
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
    const has = !!perms.meetings;

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
    console.log(`  ${String(r.roleName).padEnd(26)} ${String(users).padStart(3)} users  → grant ${hr ? "full (incl. room admin)" : "view + create"}`);
    if (apply) {
      await Role.updateOne(
        { _id: r._id },
        {
          $set: {
            "permissions.meetings": {
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
