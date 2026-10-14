/**
 * Make the logins of people who have already left inactive.
 *
 * Leaving used to change the employee record only, so resigned and terminated
 * staff kept an Active login. New leavers are handled as they leave
 * (services/leaverLogin.ts); this catches up the ones from before.
 *
 *     bun src/seeds/deactivateLeaverLogins.ts                       # report only
 *     bun src/seeds/deactivateLeaverLogins.ts --apply
 *     bun src/seeds/deactivateLeaverLogins.ts --apply --except E0103  # leave someone out
 *
 * Safe to re-run: logins already inactive are left alone.
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { LEFT_STATUSES } from "../utils/employeeStatus.js";

async function main() {
  const apply = process.argv.includes("--apply");
  const at = process.argv.indexOf("--except");
  const except = new Set(at > -1 ? String(process.argv[at + 1] ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean) : []);
  await connectDB();
  console.log(`Mode: ${apply ? "APPLY" : "dry run"}${except.size ? ` · leaving out ${[...except].join(", ")}` : ""}\n`);

  const left = await Employee.find({ status: { $in: [...LEFT_STATUSES] }, user: { $ne: null } })
    .select("name employeeCode status user").sort({ employeeCode: 1 })
    .lean<Array<{ name: string; employeeCode?: string; status: string; user: unknown }>>();
  let changed = 0;
  for (const e of left) {
    const u = await User.findById(e.user).select("status email").lean<{ status?: string; email?: string } | null>();
    if (!u || u.status === "inactive") continue;
    if (except.has(String(e.employeeCode ?? "").toUpperCase())) {
      console.log(`  ${e.employeeCode} ${e.name} · ${e.status} · login ${u.status} — left out`);
      continue;
    }
    console.log(`  ${e.employeeCode} ${e.name} · ${e.status} · login ${u.status} → inactive`);
    if (apply) await User.updateOne({ _id: e.user }, { $set: { status: "inactive" }, $inc: { tokenVersion: 1 } });
    changed++;
  }
  console.log(`\n${changed} login(s) ${apply ? "made inactive" : "would be made inactive"}.`);
  if (!apply) console.log("Dry run — re-run with --apply to write.");
  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
