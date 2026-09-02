/**
 * Prove the approvals inbox cannot show one tenant another tenant's requests.
 *
 * Read-only: it lists and changes nothing.
 *
 *     bun src/seeds/verifyInboxScope.ts
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

async function report(label: string, scope: Parameters<typeof svc.list>[1]) {
  const { rows, total } = await svc.list({ view: "pending" }, scope);
  const byOrg = rows.reduce<Record<string, number>>((a, r) => {
    const k = r.organization.name ?? "(none)";
    a[k] = (a[k] ?? 0) + 1;
    return a;
  }, {});
  const byMod = rows.reduce<Record<string, number>>((a, r) => { a[r.module] = (a[r.module] ?? 0) + 1; return a; }, {});
  console.log(`\n${label}`);
  console.log(`  rows: ${total}`);
  console.log(`  organisations: ${JSON.stringify(byOrg)}`);
  console.log(`  modules: ${JSON.stringify(byMod)}`);
  return rows;
}

async function main() {
  await connectDB();
  const orgs = await Organization.find({}).select("_id name status").lean();
  console.log(`organisations on this cluster: ${orgs.map((o) => `${o.name}${o.status === "active" ? "" : " (inactive)"}`).join(" | ")}`);

  const everything = await report("SUPER ADMIN — every organisation", SYSTEM_SCOPE);

  // The org the staff are in.
  const main0 = orgs.find((o) => /Delta International/i.test(o.name)) ?? orgs[0]!;
  const orgId = String(main0._id);

  // HR Manager.
  const hrRole = await Role.findOne({ roleName: "HR Manager" }).lean();
  const hrUser = hrRole ? await User.findOne({ organization: orgId, role: hrRole._id }).select("_id name").lean() : null;
  if (hrUser) {
    const scope = await inOrg(orgId, () =>
      resolveInboxScope({ userId: String(hrUser._id), email: "", roleId: String(hrRole!._id), role: hrRole as never }, orgId)
    );
    await inOrg(orgId, () => report(`HR MANAGER (${hrUser.name}) — own organisation only`, scope));
  }

  // A department head.
  // Every headed department, not just the first — an empty one proves nothing.
  const headed = await Department.find({ organization: orgId, leader: { $ne: null } }).select("name leader leaderKind").lean();
  for (const dept of headed) {
    const e = dept.leaderKind === "User" ? null : await Employee.findById(dept.leader).select("name user").lean();
    const headUserId = e?.user ? String(e.user) : String(dept.leader);
    const hu = await User.findById(headUserId).select("name role").lean();
    const role = hu?.role ? await Role.findById(hu.role).lean() : null;
    const scope = await inOrg(orgId, () =>
      resolveInboxScope({ userId: headUserId, email: "", roleId: String(hu?.role ?? ""), role: role as never }, orgId)
    );
    const rows = await inOrg(orgId, () => report(`DEPARTMENT HEAD (${hu?.name}, ${dept.name}) — own team only`, scope));

    // Every row must be somebody in their department.
    const team = await Employee.find({ organization: orgId, department: dept._id, user: { $ne: null } }).select("user name").lean();
    const teamIds = new Set(team.map((t) => String(t.user)));
    const strays = rows.filter((r) => r.raisedBy?.id && !teamIds.has(String(r.raisedBy.id)));
    console.log(`  every row from their own department? ${strays.length === 0 ? "YES" : `NO — ${strays.length} stray(s): ${strays.map((s) => s.raisedBy?.name).join(", ")}`}`);
    console.log(`  own request excluded? ${rows.every((r) => String(r.raisedBy?.id) !== headUserId) ? "YES" : "NO"}`);
    console.log(`  rows a Super Admin sees that they do not: ${everything.length - rows.length}`);
  }

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
