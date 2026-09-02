/**
 * What department-head approvals would actually do, against real data.
 *
 * Read-only: it reports and changes nothing.
 *
 *     bun src/seeds/verifyDeptHeads.ts
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { Department } from "../models/Department.js";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { Role } from "../models/Role.js";
import { Organization } from "../models/Organization.js";
import { runWithOrg } from "../utils/orgContext.js";
import { departmentsHeadedBy, teamMemberUserIds, headsDepartmentOf, headContactFor } from "../services/departmentHeadService.js";
import { resolveInboxScope, scopeFilterFor, scopeIsEmpty } from "../services/approvalInboxService.js";
import type { ApprovalModule } from "../services/approvalRegistry.js";

const inOrg = <T>(orgId: string, fn: () => Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => runWithOrg({ orgId, isSuperAdmin: false }, () => fn().then(resolve, reject)));

const MODULES: ApprovalModule[] = ["leave", "regularization", "reimbursement", "confirmation", "hiring", "offer", "resignation", "agreement"];

async function main() {
  await connectDB();
  const orgs = await Organization.find({ status: "active" }).select("_id name").lean();

  for (const org of orgs) {
    const orgId = String(org._id);
    const depts = await Department.find({ organization: orgId }).select("name leader leaderKind").lean();
    const withHead = depts.filter((d) => d.leader);
    if (!depts.length) continue;

    console.log(`\n━━━ ${org.name} — ${withHead.length}/${depts.length} departments have a head`);
    if (!withHead.length) continue;

    for (const d of withHead) {
      // Resolve the head to a login, whichever way they are recorded.
      let headUserId: string | null = null;
      let headName = "?";
      if (d.leaderKind === "User") {
        const u = await User.findById(d.leader).select("name email").lean();
        headUserId = u ? String(u._id) : null;
        headName = String(u?.name ?? "?");
      } else {
        const e = await Employee.findById(d.leader).select("name user").lean();
        headUserId = e?.user ? String(e.user) : null;
        headName = String(e?.name ?? "?");
      }
      if (!headUserId) { console.log(`  ${d.name}: head "${headName}" has no login — nothing routes to them`); continue; }

      const owned = await inOrg(orgId, () => departmentsHeadedBy(headUserId!));
      const team = await inOrg(orgId, () => teamMemberUserIds(headUserId!));
      console.log(`\n  ${d.name} — head: ${headName}`);
      console.log(`    departments resolved: ${owned.length}   team size: ${team.length}`);

      // Their inbox scope.
      const user = await User.findById(headUserId).select("role").lean();
      const role = user?.role ? await Role.findById(user.role).lean() : null;
      const scope = await inOrg(orgId, () =>
        resolveInboxScope({ userId: headUserId!, email: "", roleId: String(user?.role ?? ""), role: role as never }, orgId)
      );
      const visible = MODULES.filter((m) => scopeFilterFor(scope, m) !== null);
      console.log(`    role: ${role?.roleName ?? "?"}   sees queues: ${visible.join(", ") || "(none)"}`);
      console.log(`    empty scope? ${scopeIsEmpty(scope)}`);

      // Cross-checks that matter: a team member yes, an outsider no, self no.
      if (team.length) {
        const inside = team[0]!;
        const outsider = await Employee.findOne({ organization: orgId, department: { $ne: d._id }, user: { $ne: null } }).select("user name").lean();
        console.log(`    heads a member?        ${await inOrg(orgId, () => headsDepartmentOf(headUserId!, inside))}  (expect true)`);
        if (outsider?.user) {
          console.log(`    heads an outsider?     ${await inOrg(orgId, () => headsDepartmentOf(headUserId!, String(outsider.user)))}  (expect false)`);
        }
        console.log(`    heads themselves?      ${await inOrg(orgId, () => headsDepartmentOf(headUserId!, headUserId!))}  (expect false)`);
        const contact = await inOrg(orgId, () => headContactFor(inside));
        console.log(`    member's head resolves to: ${contact ? `${contact.name} <${contact.email}>` : "null — no mail would be sent"}`);
      }
    }

    // And what everybody else gets.
    console.log(`\n  ── other roles in ${org.name}`);
    // Roles that people in this org actually hold — a role document may be
    // global, so filtering roles by organisation misses most of them.
    const roleIds = await User.distinct("role", { organization: orgId });
    const roles = await Role.find({ _id: { $in: roleIds } }).lean();
    for (const r of roles) {
      const someone = await User.findOne({ organization: orgId, role: r._id }).select("_id").lean();
      if (!someone) continue;
      const headcount = await User.countDocuments({ organization: orgId, role: r._id });
      const scope = await inOrg(orgId, () =>
        resolveInboxScope({ userId: String(someone._id), email: "", roleId: String(r._id), role: r as never }, orgId)
      );
      const visible = MODULES.filter((m) => scopeFilterFor(scope, m) !== null);
      console.log(`    ${String(r.roleName).padEnd(26)} ${String(headcount).padStart(3)} people  sees: ${visible.join(", ") || "(nothing — page refused)"}`);
    }
  }

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
