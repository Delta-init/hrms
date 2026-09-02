/**
 * Prove the approvals department filter narrows to exactly that department.
 *
 * Read-only: it lists and changes nothing.
 *
 *     bun src/seeds/verifyDeptFilter.ts
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { Department } from "../models/Department.js";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { Role } from "../models/Role.js";
import { Organization } from "../models/Organization.js";
import { runWithOrg } from "../utils/orgContext.js";
import { ApprovalInboxService, resolveInboxScope, SYSTEM_SCOPE } from "../services/approvalInboxService.js";

const svc = new ApprovalInboxService();
const inOrg = <T>(orgId: string, fn: () => Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => runWithOrg({ orgId, isSuperAdmin: false }, () => fn().then(resolve, reject)));

async function main() {
  await connectDB();
  const org = (await Organization.find({ status: "active" }).select("_id name").lean())
    .find((o) => /Delta International/i.test(o.name))!;
  const orgId = String(org._id);

  const all = await svc.list({ view: "pending" }, SYSTEM_SCOPE);
  console.log(`Super Admin, no filter: ${all.total} rows\n`);

  const depts = await Department.find({ organization: orgId }).select("name").sort({ name: 1 }).lean();
  let summed = 0;
  for (const d of depts) {
    const rows = (await svc.list({ view: "pending", department: String(d._id) }, SYSTEM_SCOPE)).rows;
    if (!rows.length) continue;
    summed += rows.length;

    // Every row must belong to somebody in that department.
    const members = await Employee.find({ department: d._id }).select("_id user name").lean();
    const userIds = new Set(members.filter((m) => m.user).map((m) => String(m.user)));
    const empIds = new Set(members.map((m) => String(m._id)));
    const strays = rows.filter((r) => {
      const id = r.raisedBy?.id ? String(r.raisedBy.id) : null;
      // hiring names the department itself, so its raisedBy is the requester.
      if (r.module === "hiring") return false;
      return id !== null && !userIds.has(id) && !empIds.has(id);
    });
    const mods = rows.reduce<Record<string, number>>((a, r) => { a[r.module] = (a[r.module] ?? 0) + 1; return a; }, {});
    console.log(`${String(d.name).padEnd(34)} ${String(rows.length).padStart(3)} rows  ${JSON.stringify(mods)}` +
      (strays.length ? `  ⚠️ ${strays.length} STRAY: ${strays.map((x) => `${x.module}/${x.raisedBy?.name}`).join(", ")}` : "  ✓ all in department"));
  }
  console.log(`\nsum over departments: ${summed} of ${all.total} unfiltered`);
  console.log(`(the difference is rows raised by people in no department, plus offers, which cannot be filtered by one)`);

  // A head asking for a department they do not head must get nothing.
  const sales = await Department.findOne({ organization: orgId, name: /SALES/i }).select("_id name leader leaderKind").lean();
  const other = await Department.findOne({ organization: orgId, _id: { $ne: sales!._id } }).select("_id name").lean();
  if (sales?.leader) {
    const e = await Employee.findById(sales.leader).select("name user").lean();
    const headUserId = String(e!.user);
    const hu = await User.findById(headUserId).select("name role").lean();
    const role = await Role.findById(hu!.role).lean();
    const scope = await inOrg(orgId, () =>
      resolveInboxScope({ userId: headUserId, email: "", roleId: String(hu!.role), role: role as never }, orgId)
    );
    const own = await inOrg(orgId, () => svc.list({ view: "pending", department: String(sales._id) }, scope));
    const notOwn = await inOrg(orgId, () => svc.list({ view: "pending", department: String(other!._id) }, scope));
    console.log(`\n${e!.name} (heads ${sales.name}):`);
    console.log(`  filtering to ${sales.name}: ${own.total} rows  (expect their team's)`);
    console.log(`  filtering to ${other!.name}: ${notOwn.total} rows  (expect 0 — not theirs to see)`);
  }

  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
