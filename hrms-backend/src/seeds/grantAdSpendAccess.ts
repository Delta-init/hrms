/**
 * Grant the new `adSpend` permission to the roles that should have it.
 *
 * A new module is absent from every role that already exists, and
 * `checkPermission` refuses what it cannot find — until this runs nobody but
 * Super Admin can open Hiring › Ad spend.
 *
 * Unlike most grants this is not for everybody: the ad budget is not every
 * employee's business. Three kinds of role get it —
 *   - HR: everything, including the platforms and the budget;
 *   - whoever recruits (a role that may raise hiring records but is not HR):
 *     read, log weeks and export — not the budget;
 *   - business administration, i.e. management: read and export.
 *
 *     bun src/seeds/grantAdSpendAccess.ts            # report only
 *     bun src/seeds/grantAdSpendAccess.ts --apply
 *
 * Safe to re-run: a role that already has it is left alone.
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";

const HR = ["HR Manager", "HR Manager (Full Access)"];
const MANAGEMENT = /^business administration/i;

type Perms = Record<string, Record<string, boolean> | undefined>;

function grantFor(roleName: string, perms: Perms) {
  if (HR.includes(roleName)) {
    return { label: "HR — everything", set: { view: true, create: true, edit: true, delete: true, approve: false, export: true } };
  }
  if (perms.hiring?.create) {
    return { label: "recruiter — view, log weeks, export", set: { view: true, create: true, edit: false, delete: false, approve: false, export: true } };
  }
  if (MANAGEMENT.test(roleName)) {
    return { label: "management — view, export", set: { view: true, create: false, edit: false, delete: false, approve: false, export: true } };
  }
  return null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  await connectDB();
  console.log(`Mode: ${apply ? "APPLY" : "dry run"}\n`);

  const roles = await Role.find({}).lean();
  for (const r of roles) {
    const perms = (r as { permissions?: Perms }).permissions ?? {};
    const users = await User.countDocuments({ role: r._id, status: { $ne: "inactive" } });
    const name = String(r.roleName);
    const line = `  ${name.padEnd(38)} ${String(users).padStart(3)} users`;

    if (r.isSystemRole && name === "Super Admin") { console.log(`${line}  — bypasses permissions`); continue; }
    // An entry with every action off (new roles get one for each module) is not access.
    if (Object.values(perms.adSpend ?? {}).some((v) => v === true)) { console.log(`${line}  — already has it`); continue; }
    const grant = grantFor(name, perms);
    if (!grant) { console.log(`${line}  — not given it`); continue; }

    console.log(`${line}  → ${grant.label}`);
    if (apply) await Role.updateOne({ _id: r._id }, { $set: { "permissions.adSpend": grant.set } });
  }

  console.log(apply ? "\nGranted." : "\nDry run — re-run with --apply to grant.");
  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
