/**
 * What the search box returns for each kind of user, and what a decision
 * notifies. Read-only: it searches and counts, and writes nothing.
 *
 *     bun src/seeds/verifySearchAndNotify.ts
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { Organization } from "../models/Organization.js";
import { Role } from "../models/Role.js";
import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import { Department } from "../models/Department.js";
import { runWithOrg } from "../utils/orgContext.js";
import { globalSearch } from "../services/globalSearchService.js";
import { watchersFor } from "../services/watchers.js";

const inOrg = <T>(orgId: string, fn: () => Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => runWithOrg({ orgId, isSuperAdmin: false }, () => fn().then(resolve, reject)));

async function main() {
  await connectDB();
  const org = (await Organization.findOne({ name: /Delta International/i }).select("_id name").lean())!;
  const orgId = String(org._id);

  const roleIds = await User.distinct("role", { organization: orgId });
  const roles = await Role.find({ _id: { $in: roleIds } }).lean();

  console.log("━━━ SEARCH — what each role can find\n");
  for (const term of ["sinan", "sales", "E0133"]) {
    console.log(`  query "${term}"`);
    for (const r of roles) {
      const hits = await inOrg(orgId, () => globalSearch(term, r as never));
      const byGroup = hits.reduce<Record<string, number>>((a, h) => { a[h.group] = (a[h.group] ?? 0) + 1; return a; }, {});
      const sample = hits[0] ? `  e.g. ${hits[0].title} → ${hits[0].href}` : "";
      console.log(`    ${String(r.roleName).padEnd(26)} ${String(hits.length).padStart(2)} hits ${JSON.stringify(byGroup)}${sample}`);
    }
    console.log("");
  }

  // Does an ordinary employee's result leak an email?
  const employeeRole = roles.find((r) => r.roleName === "Employee");
  const hrRole = roles.find((r) => r.roleName === "HR Manager");
  if (employeeRole && hrRole) {
    const asEmp = await inOrg(orgId, () => globalSearch("sinan", employeeRole as never));
    const asHr = await inOrg(orgId, () => globalSearch("sinan", hrRole as never));
    const leak = asEmp.filter((h) => /@/.test(h.subtitle));
    console.log(`  employee results containing an email address: ${leak.length} (expect 0)`);
    console.log(`  HR results containing an email address:       ${asHr.filter((h) => /@/.test(h.subtitle)).length}`);
    console.log(`  employee link target: ${asEmp[0]?.href}   HR link target: ${asHr[0]?.href}`);
  }

  console.log("\n━━━ NOTIFICATIONS — who hears about a request\n");
  const depts = await Department.find({ organization: orgId, leader: { $ne: null } }).select("name leader").lean();
  for (const d of depts) {
    const e = await Employee.findById(d.leader).select("name user").lean();
    const member = await Employee.findOne({ organization: orgId, department: d._id, user: { $ne: null }, _id: { $ne: d.leader } })
      .select("name user").lean();
    if (!member?.user) continue;
    const w = await inOrg(orgId, () => watchersFor("leave", String(member.user)));
    const names = await User.find({ _id: { $in: w } }).select("name").lean();
    console.log(`  ${member.name} (${d.name}) applies → ${w.length} watcher(s): ${names.map((n) => n.name).join(", ")}`);
    console.log(`     head is ${e?.name}: ${names.some((n) => n.name === e?.name) ? "included ✓" : "MISSING ✗"}`);
  }
  // Somebody with no department.
  const orphan = await Employee.findOne({ organization: orgId, department: null, user: { $ne: null }, status: { $ne: "terminated" } })
    .select("name user").lean();
  if (orphan?.user) {
    const w = await inOrg(orgId, () => watchersFor("leave", String(orphan.user)));
    const names = await User.find({ _id: { $in: w } }).select("name").lean();
    console.log(`  ${orphan.name} (no department) applies → ${w.length} watcher(s): ${names.map((n) => n.name).join(", ")}`);
  }

  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
