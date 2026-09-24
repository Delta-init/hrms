/**
 * The role that runs office keeping, the meeting rooms and buying things.
 *
 * Built from the role its holder is on today rather than from a blank slate:
 * the job is the same job with three modules added, and hand-listing the
 * twelve modules she already has is how somebody quietly loses their leave
 * form. Four modules are set outright, everything else is carried across:
 *
 *   assets         everything except approve — nothing in the app reads
 *                  `assets.approve`, and issuing a laptop is `edit`
 *   procurement    all six — raising a request and passing it to finance
 *   meetings       all six — `edit` is what adds and retires the rooms
 *   officeKeeping  all six — the panel, and the address the request mail goes to
 *
 * The mail follows from the permission, not from this script: office keeping
 * asks "who holds officeKeeping.approve" when a request comes in, which after
 * this is this role and HR. Nothing hard-codes a name or an employee id.
 *
 *     bun src/seeds/createBusinessAdminRole.ts            # report only
 *     bun src/seeds/createBusinessAdminRole.ts --apply
 *
 * Safe to re-run: an existing role is updated in place, and a holder already
 * on it is left alone. To undo, move the user back to FROM_ROLE — the old role
 * is never deleted.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import { HRMS_MODULES } from "../types/index.js";
import type { ModulePermissions } from "../types/index.js";

const NEW_ROLE = "Business Administration (Full Access)";
const FROM_ROLE = "business administration";
const DESCRIPTION = "Office keeping, meeting rooms and procurement, plus day-to-day asset management.";

const ACTIONS = ["view", "create", "edit", "delete", "approve", "export"] as const;
const all = (): ModulePermissions => ({ view: true, create: true, edit: true, delete: true, approve: true, export: true });
const allBut = (...off: Array<(typeof ACTIONS)[number]>): ModulePermissions => {
  const p = all();
  for (const a of off) p[a] = false;
  return p;
};

/** The four this role is being created for. Everything else is inherited. */
const OVERRIDES: Partial<Record<(typeof HRMS_MODULES)[number], ModulePermissions>> = {
  assets: allBut("approve"),
  procurement: all(),
  meetings: all(),
  officeKeeping: all(),
};

const shown = (p?: Partial<ModulePermissions>) =>
  ACTIONS.filter((a) => p?.[a]).join(", ") || "—";

async function main() {
  const apply = process.argv.includes("--apply");
  await connectDB();
  console.log(`Mode: ${apply ? "APPLY" : "dry run"}\n`);

  const from = await Role.findOne({ roleName: FROM_ROLE }).lean<{
    _id: unknown; organization?: unknown; permissions?: Record<string, ModulePermissions>;
  } | null>();
  if (!from) throw new Error(`Role "${FROM_ROLE}" not found — nothing to build from`);

  // Start from what the current role grants, then set the four outright.
  const permissions: Record<string, ModulePermissions> = {};
  for (const mod of HRMS_MODULES) {
    const inherited = from.permissions?.[mod];
    const override = OVERRIDES[mod];
    if (override) permissions[mod] = override;
    else if (inherited && ACTIONS.some((a) => inherited[a])) {
      permissions[mod] = { ...all(), ...Object.fromEntries(ACTIONS.map((a) => [a, !!inherited[a]])) } as ModulePermissions;
    }
  }

  console.log(`${NEW_ROLE}`);
  for (const mod of HRMS_MODULES) {
    if (!permissions[mod]) continue;
    const before = shown(from.permissions?.[mod]);
    const after = shown(permissions[mod]);
    const changed = before !== after;
    console.log(`  ${mod.padEnd(16)} ${after}${changed ? `      (was: ${before})` : ""}`);
  }

  const existing = await Role.findOne({ roleName: NEW_ROLE }).lean<{ _id: unknown } | null>();
  console.log(`\n  ${existing ? "role exists — permissions will be updated in place" : "role will be created"}`);

  // Whoever is on the old role is who this was built for.
  const holders = await User.find({ role: from._id, status: { $ne: "inactive" } })
    .select("name email").lean<Array<{ _id: unknown; name?: string; email?: string }>>();
  console.log(`\nMoving ${holders.length} holder${holders.length === 1 ? "" : "s"} of "${FROM_ROLE}":`);
  for (const u of holders) {
    const emp = await Employee.findOne({ user: u._id }).select("name employeeCode").lean<{ name?: string; employeeCode?: string } | null>();
    console.log(`  ${String(emp?.name ?? u.name).padEnd(24)} ${String(emp?.employeeCode ?? "—").padEnd(7)} ${u.email}`);
  }
  if (!holders.length) console.log("  (nobody — the role is created but assigned to no one)");

  if (!apply) {
    console.log(`\nDry run — re-run with --apply to write. "${FROM_ROLE}" is kept either way.`);
    await mongoose.disconnect();
    return;
  }

  const roleId = existing
    ? (await Role.updateOne({ _id: existing._id }, { $set: { permissions, description: DESCRIPTION } }), existing._id)
    : (await Role.create({
        roleName: NEW_ROLE, description: DESCRIPTION, permissions,
        isSystemRole: false, organization: from.organization ?? null,
      }))._id;

  if (holders.length) {
    await User.updateMany({ _id: { $in: holders.map((u) => u._id) } }, { $set: { role: roleId } });
  }

  console.log(`\nDone. "${FROM_ROLE}" is left in place with ${await User.countDocuments({ role: from._id, status: { $ne: "inactive" } })} holders — move somebody back to undo.`);
  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
