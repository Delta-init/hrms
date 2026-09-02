/**
 * What the midday digest would send, without sending it.
 *
 * Read-only: it builds the recipient list and the row counts and stops. Worth
 * running before this reaches anybody's inbox — a digest is one of the few
 * features whose first real test is otherwise a hundred people's mail.
 *
 *     bun src/seeds/previewHeadDigest.ts
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { Organization } from "../models/Organization.js";
import { Department } from "../models/Department.js";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Regularization } from "../models/Regularization.js";

async function main() {
  await connectDB();
  for (const org of await Organization.find({ status: "active" }).select("_id name").lean()) {
    const [leave, corr] = await Promise.all([
      LeaveRequest.find({ organization: org._id, status: "pending" }).select("user").lean(),
      Regularization.find({ organization: org._id, status: "pending" }).select("user").lean(),
    ]);
    const pending = [...leave, ...corr].map((r) => String(r.user));
    console.log(`\n━━━ ${org.name}: ${pending.length} pending (${leave.length} leave, ${corr.length} corrections)`);

    const depts = await Department.find({ organization: org._id }).select("name leader leaderKind").lean();
    let mails = 0;
    for (const d of depts) {
      if (!d.leader) continue;
      let headUserId: string | null = null, headName = "?";
      if (d.leaderKind === "User") {
        const u = await User.findById(d.leader).select("name").lean();
        headUserId = u ? String(u._id) : null; headName = String(u?.name ?? "?");
      } else {
        const e = await Employee.findById(d.leader).select("name user").lean();
        headUserId = e?.user ? String(e.user) : null; headName = String(e?.name ?? "?");
      }
      if (!headUserId) { console.log(`  ${d.name}: head ${headName} has no login — not mailed`); continue; }
      const members = await Employee.find({ organization: org._id, department: d._id, user: { $ne: null } }).select("user").lean();
      const ids = new Set(members.map((m) => String(m.user)).filter((id) => id !== headUserId));
      const mine = pending.filter((u) => ids.has(u)).length;
      const login = await User.findById(headUserId).select("email").lean();
      if (!mine) { console.log(`  ${d.name}: ${headName} — nothing pending, not mailed`); continue; }
      if (!login?.email) { console.log(`  ${d.name}: ${headName} has no email — not mailed`); continue; }
      console.log(`  ${d.name}: ${headName} <${login.email}> would get ${mine} row(s)`);
      mails++;
    }
    console.log(`  → ${mails} head email(s), plus the existing one to HR`);
    console.log(`  → ${depts.filter((d) => !d.leader).length} of ${depts.length} departments have no head, so nothing routes to them`);
  }
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
