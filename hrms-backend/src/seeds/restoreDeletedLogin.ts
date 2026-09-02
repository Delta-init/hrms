/**
 * Put back a login that was deleted out from under its records.
 *
 * Deleting a login is a hard delete and it nulls the employee's reference in
 * the same operation, so afterwards nothing describes the account that existed.
 * What survives is its id, still carried by every record it owned, and its
 * fields, still present in the GreytHR exports the migration was fed from.
 * `findOrphanedUsers` finds the first; `exportEmployeeDossier` reads the second.
 * This writes the account back from both.
 *
 * Reusing the original id is the whole point. A new account with a new id
 * leaves the old leave requests and payslips pointing at nobody; the same id
 * reconnects them the moment it exists.
 *
 * It is a reconstruction, not a restore — the password is gone and cannot be
 * recovered, so a fresh unguessable one is set and the account is flagged to
 * change it. Nobody is told that password and nobody needs it: reactivating
 * this account means sending an invitation, not handing over a secret.
 *
 *     bun src/seeds/restoreDeletedLogin.ts --code=E0122 --user-id=<id> --role=Employee \
 *       --schedule="10:00am - 7:00pm" --status=inactive
 *     …and again with --apply to write it.
 */
import mongoose from "mongoose";
import crypto from "node:crypto";
import { connectDB } from "../config/database.js";
import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import { Role } from "../models/Role.js";
import { WorkSchedule } from "../models/WorkSchedule.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Payslip } from "../models/Payslip.js";
import { Attendance } from "../models/Attendance.js";

const arg = (k: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : undefined;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const code = arg("code");
  const userId = arg("user-id");
  const roleName = arg("role");
  const scheduleName = arg("schedule");
  const status = (arg("status") ?? "inactive") as "active" | "inactive" | "invited";
  if (!code || !userId || !roleName) {
    console.error("Need --code, --user-id and --role.");
    process.exit(1);
  }

  await connectDB();
  console.log(`Mode: ${apply ? "APPLY" : "dry run"}\n`);

  const emp = await Employee.findOne({ employeeCode: code }).lean();
  if (!emp) throw new Error(`No employee ${code}`);
  const orgId = emp.organization;

  // Refuse rather than overwrite. If the id or the address is in use, this is
  // not the situation the script was written for and guessing would be worse
  // than stopping.
  const idTaken = await User.findById(userId).select("_id email").lean();
  if (idTaken) throw new Error(`That id already belongs to a login (${idTaken.email}) — nothing to restore`);
  const email = String(emp.email ?? "").trim().toLowerCase();
  if (!email) throw new Error(`${code} has no email on the employee record to restore the login with`);
  const emailTaken = await User.findOne({ email }).select("_id name").lean();
  if (emailTaken) throw new Error(`${email} already belongs to ${emailTaken.name} (${emailTaken._id})`);
  if (emp.user) throw new Error(`${code} already has a login (${emp.user}) — nothing to restore`);

  const role = await Role.findOne({ roleName, $or: [{ organization: orgId }, { organization: null }] }).lean();
  if (!role) throw new Error(`No role named "${roleName}"`);
  const schedule = scheduleName
    ? await WorkSchedule.findOne({ organization: orgId, name: scheduleName }).lean()
    : null;
  if (scheduleName && !schedule) throw new Error(`No work schedule named "${scheduleName}"`);

  // What comes back to life the moment the id exists again.
  const [leaves, payslips, attendance] = await Promise.all([
    LeaveRequest.countDocuments({ user: userId }),
    Payslip.countDocuments({ user: userId }),
    Attendance.countDocuments({ user: userId }),
  ]);

  console.log("Would write User:");
  console.log(`  _id           ${userId}`);
  console.log(`  name          ${emp.name}`);
  console.log(`  email         ${email}`);
  console.log(`  role          ${role._id}  (${role.roleName})`);
  console.log(`  organization  ${orgId}`);
  console.log(`  workSchedule  ${schedule ? `${schedule._id}  (${schedule.name})` : "none"}`);
  console.log(`  designation   ${emp.designation ?? "—"}`);
  console.log(`  status        ${status}`);
  console.log(`  password      (random, discarded — mustResetPassword is set)`);
  console.log(`\nWould relink Employee ${emp._id} (${code}): user null → ${userId}`);
  console.log(`\nRecords that reconnect: ${leaves} leave, ${payslips} payslip(s), ${attendance} attendance`);

  if (!apply) {
    console.log("\nDry run — re-run with --apply to write it.");
    await mongoose.disconnect();
    return;
  }

  // Through `create` rather than a raw insert, so the pre-save hook hashes the
  // password the way every other account's is hashed.
  await User.create({
    _id: new mongoose.Types.ObjectId(userId),
    name: emp.name,
    email,
    password: crypto.randomBytes(24).toString("base64url"),
    role: role._id,
    organization: orgId,
    workSchedule: schedule?._id ?? null,
    designation: emp.designation ?? undefined,
    status,
    mustResetPassword: true,
  });
  await Employee.updateOne({ _id: emp._id }, { $set: { user: userId } });

  const back = await User.findById(userId).populate("role", "roleName").populate("workSchedule", "name").lean();
  const linked = await Employee.findById(emp._id).select("user").lean();
  console.log("\n✅ Written. Read back:");
  console.log(`  ${back?.name} <${back?.email}>  role=${(back?.role as { roleName?: string })?.roleName}  status=${back?.status}`);
  console.log(`  schedule=${(back?.workSchedule as { name?: string } | null)?.name ?? "none"}  mustResetPassword=${back?.mustResetPassword}`);
  console.log(`  employee ${code} now points at ${linked?.user}`);
  console.log(`  reconnected: ${await LeaveRequest.countDocuments({ user: userId })} leave, ${await Payslip.countDocuments({ user: userId })} payslip(s)`);

  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(`\n✗ ${e instanceof Error ? e.message : e}`); await mongoose.disconnect(); process.exit(1); });
