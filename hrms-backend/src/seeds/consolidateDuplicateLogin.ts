/**
 * One person with two logins, reduced to one.
 *
 * It happens when an account is created by hand and then the same person is
 * migrated in with their employee record: the hand-made one carries the role
 * they work under, and the migrated one carries the employee link, the work
 * schedule and the history. Neither is complete, and the one they sign in to
 * decides which half they get.
 *
 * The wrong half to keep is the one with no employee record. Attendance is
 * stored against a login, but every screen that shows it joins back through
 * the employee — so punches made from a login no employee points at are
 * written successfully and then never appear anywhere, which is worse than
 * being refused.
 *
 * So the account with the employee record is kept and given the role, and the
 * other is deactivated rather than deleted — its notifications and any
 * decisions it made stay readable, and the move is reversible.
 *
 *     bun src/seeds/consolidateDuplicateLogin.ts --keep=a@x.com --retire=b@x.com --role="HR Manager"
 *     …and again with --apply.
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import { Role } from "../models/Role.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Regularization } from "../models/Regularization.js";

const arg = (k: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : undefined;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const keepEmail = arg("keep")?.toLowerCase();
  const retireEmail = arg("retire")?.toLowerCase();
  const roleName = arg("role");
  if (!keepEmail || !retireEmail || !roleName) {
    console.error("Need --keep, --retire and --role.");
    process.exit(1);
  }

  await connectDB();
  console.log(`Mode: ${apply ? "APPLY" : "dry run"}\n`);

  const keep = await User.findOne({ email: keepEmail });
  const retire = await User.findOne({ email: retireEmail });
  if (!keep) throw new Error(`No login ${keepEmail}`);
  if (!retire) throw new Error(`No login ${retireEmail}`);
  if (String(keep._id) === String(retire._id)) throw new Error("Those are the same account");

  const role = await Role.findOne({ roleName, $or: [{ organization: keep.organization }, { organization: null }] }).lean();
  if (!role) throw new Error(`No role named "${roleName}"`);

  const keepEmp = await Employee.findOne({ user: keep._id }).select("employeeCode name").lean();
  const retireEmp = await Employee.findOne({ user: retire._id }).select("employeeCode name").lean();
  if (!keepEmp) throw new Error(`${keepEmail} has no employee record — keeping it would strand every punch it makes`);
  if (retireEmp) throw new Error(`${retireEmail} is linked to employee ${retireEmp.employeeCode}; retiring it would leave that record with no login`);

  /**
   * Somebody has to be left holding this role.
   *
   * Moving it to one account while switching another off is two steps that
   * both change who can do the job, and getting the order wrong on the last
   * holder of a role locks the work out entirely.
   */
  const stillHolding = await User.countDocuments({
    role: role._id,
    status: { $ne: "inactive" },
    _id: { $nin: [retire._id] },
  });

  console.log(`keep    ${keep.name} <${keep.email}>  employee ${keepEmp.employeeCode}  role → ${role.roleName}`);
  console.log(`retire  ${retire.name} <${retire.email}>  no employee record  → status inactive`);
  console.log(`\nthe retired account has raised: ${await LeaveRequest.countDocuments({ user: retire._id })} leave, ${await Regularization.countDocuments({ user: retire._id })} corrections`);
  console.log(`and decided:                    ${await LeaveRequest.countDocuments({ reviewedBy: retire._id })} leave, ${await Regularization.countDocuments({ reviewedBy: retire._id })} corrections`);
  console.log(`\n"${role.roleName}" holders after this: ${stillHolding + 1} (including the kept account)`);

  if (!apply) {
    console.log("\nDry run — re-run with --apply to write it.");
    await mongoose.disconnect();
    return;
  }

  keep.role = role._id as never;
  // Anything issued against the old role is retired, or the kept account keeps
  // its previous permissions until whatever token it holds expires.
  keep.tokenVersion = (keep.tokenVersion ?? 0) + 1;
  await keep.save();

  retire.status = "inactive";
  retire.tokenVersion = (retire.tokenVersion ?? 0) + 1;
  await retire.save();

  const k = await User.findById(keep._id).populate("role", "roleName").select("name email status role workSchedule").lean();
  const r = await User.findById(retire._id).select("name email status").lean();
  console.log("\n✅ Written. Read back:");
  console.log(`  ${k?.name} <${k?.email}>  role=${(k?.role as { roleName?: string })?.roleName}  status=${k?.status}  schedule=${k?.workSchedule ?? "none"}`);
  console.log(`  ${r?.name} <${r?.email}>  status=${r?.status}`);

  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(`\n✗ ${e instanceof Error ? e.message : e}`); await mongoose.disconnect(); process.exit(1); });
