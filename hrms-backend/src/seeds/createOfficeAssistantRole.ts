/**
 * The role for whoever physically runs the office — Dinesh, today.
 *
 * Built from "Employee" rather than a blank slate: he is still an employee
 * who clocks in, takes leave and gets a payslip. Two modules are set outright:
 *
 *   officeKeeping  all six — the panel where requests are marked arriving and
 *                  sorted. Holding `approve` is also what puts him on the list
 *                  office keeping notifies, so mail, in-app, push and WhatsApp
 *                  reach him with no name written into the code.
 *   procurement    view only — he sees what's being bought and is told when
 *                  it's filed and when finance approves it (procurementService
 *                  adds office keeping's people to those two moments), but
 *                  approving spend stays with HR and Business Administration.
 *
 *     bun src/seeds/createOfficeAssistantRole.ts                          # report only
 *     bun src/seeds/createOfficeAssistantRole.ts --apply                  # create the role
 *     bun src/seeds/createOfficeAssistantRole.ts --apply --assign <email> # and move that login onto it
 *
 * Safe to re-run: an existing role is updated in place.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import { HRMS_MODULES } from "../types/index.js";
import type { ModulePermissions } from "../types/index.js";

const NEW_ROLE = "Office Assistant";
const FROM_ROLE = "Employee";
const DESCRIPTION = "Runs office keeping; is told about procurement without approving it.";

const ACTIONS = ["view", "create", "edit", "delete", "approve", "export"] as const;
const all = (): ModulePermissions => ({ view: true, create: true, edit: true, delete: true, approve: true, export: true });
const only = (...on: Array<(typeof ACTIONS)[number]>): ModulePermissions => {
  const p: ModulePermissions = { view: false, create: false, edit: false, delete: false, approve: false, export: false };
  for (const a of on) p[a] = true;
  return p;
};

const OVERRIDES: Partial<Record<(typeof HRMS_MODULES)[number], ModulePermissions>> = {
  officeKeeping: all(),
  procurement: only("view"),
};

const shown = (p?: Partial<ModulePermissions>) => ACTIONS.filter((a) => p?.[a]).join(", ") || "—";

async function main() {
  const apply = process.argv.includes("--apply");
  const assignAt = process.argv.indexOf("--assign");
  const assignEmail = assignAt > -1 ? process.argv[assignAt + 1]?.toLowerCase() : undefined;
  await connectDB();
  console.log(`Mode: ${apply ? "APPLY" : "dry run"}\n`);

  const from = await Role.findOne({ roleName: FROM_ROLE }).lean<{
    _id: unknown; organization?: unknown; permissions?: Record<string, ModulePermissions>;
  } | null>();
  if (!from) throw new Error(`Role "${FROM_ROLE}" not found — nothing to build from`);

  const permissions: Record<string, ModulePermissions> = {};
  for (const mod of HRMS_MODULES) {
    const inherited = from.permissions?.[mod];
    const override = OVERRIDES[mod];
    if (override) permissions[mod] = override;
    else if (inherited && ACTIONS.some((a) => inherited[a])) {
      permissions[mod] = Object.fromEntries(ACTIONS.map((a) => [a, !!inherited[a]])) as unknown as ModulePermissions;
    }
  }

  console.log(NEW_ROLE);
  for (const mod of HRMS_MODULES) {
    if (!permissions[mod]) continue;
    const before = shown(from.permissions?.[mod]);
    const after = shown(permissions[mod]);
    console.log(`  ${mod.padEnd(18)} ${after}${before !== after ? `      (Employee has: ${before})` : ""}`);
  }

  const existing = await Role.findOne({ roleName: NEW_ROLE }).lean<{ _id: unknown } | null>();
  console.log(`\n  ${existing ? "role exists — permissions will be updated in place" : "role will be created"}`);

  let target: { _id: unknown; name?: string; email?: string } | null = null;
  if (assignEmail) {
    target = await User.findOne({ email: assignEmail }).select("name email").lean();
    if (!target) {
      console.log(`\n  --assign ${assignEmail}: no login with that email — add the employee first, then re-run.`);
    } else {
      const emp = await Employee.findOne({ user: target._id }).select("name employeeCode mobileNumber phone").lean<{
        name?: string; employeeCode?: string; mobileNumber?: string; phone?: string;
      } | null>();
      console.log(`\n  Will move ${emp?.name ?? target.name} (${emp?.employeeCode ?? "no employee record"}) <${target.email}> onto it.`);
      if (!emp?.mobileNumber && !emp?.phone) console.log("  ⚠ no mobile number on their employee record — WhatsApp will skip them until one is added.");
    }
  }

  if (!apply) {
    console.log("\nDry run — re-run with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  const roleId = existing
    ? (await Role.updateOne({ _id: existing._id }, { $set: { permissions, description: DESCRIPTION } }), existing._id)
    : (await Role.create({
        roleName: NEW_ROLE, description: DESCRIPTION, permissions,
        isSystemRole: false, organization: from.organization ?? null,
      }))._id;
  console.log(`\n${existing ? "Updated" : "Created"} "${NEW_ROLE}".`);

  if (target) {
    await User.updateOne({ _id: target._id }, { $set: { role: roleId } });
    console.log(`Moved <${target.email}> onto it.`);
  }
  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
