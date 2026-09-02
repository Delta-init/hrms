/**
 * User ids that records still point at, but which no longer have a login.
 *
 * User deletion is a hard delete — the document is removed outright, and the
 * employee's back-reference is nulled in the same breath — so a deleted login
 * leaves no marker anywhere saying it existed. What it does leave is every
 * other record still carrying its id: attendance, leave, payslips. Those are
 * the only evidence left, and this finds them.
 *
 * Read-only: it reports and changes nothing.
 *
 *     bun src/seeds/findOrphanedUsers.ts
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { User } from "../models/User.js";
import { Employee } from "../models/Employee.js";
import { Attendance } from "../models/Attendance.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Regularization } from "../models/Regularization.js";
import { Payslip } from "../models/Payslip.js";
import { SignedAgreement } from "../models/SignedAgreement.js";
import { Resignation } from "../models/Resignation.js";
import { Reimbursement } from "../models/Reimbursement.js";
import { RosterAssignment } from "../models/RosterAssignment.js";
import { SalaryStructureAssignment } from "../models/SalaryStructureAssignment.js";
import { FaceProfile } from "../models/FaceProfile.js";

/** Collections that carry a user id; those pairing it with an employee can
 *  rebuild the link that deletion severed. */
const SOURCES: Array<{ name: string; model: mongoose.Model<never>; pairsEmployee: boolean }> = [
  { name: "Attendance", model: Attendance as never, pairsEmployee: false },
  { name: "LeaveRequest", model: LeaveRequest as never, pairsEmployee: false },
  { name: "Regularization", model: Regularization as never, pairsEmployee: false },
  { name: "Payslip", model: Payslip as never, pairsEmployee: true },
  { name: "SignedAgreement", model: SignedAgreement as never, pairsEmployee: true },
  { name: "Resignation", model: Resignation as never, pairsEmployee: true },
  { name: "Reimbursement", model: Reimbursement as never, pairsEmployee: true },
  { name: "RosterAssignment", model: RosterAssignment as never, pairsEmployee: true },
  { name: "SalaryStructureAssignment", model: SalaryStructureAssignment as never, pairsEmployee: true },
  { name: "FaceProfile", model: FaceProfile as never, pairsEmployee: false },
];

async function main() {
  await connectDB();

  const live = new Set((await User.find({}).select("_id").lean()).map((u) => String(u._id)));
  console.log(`live logins: ${live.size}`);

  /** userId → what still references it, and what it can be traced back to. */
  const orphans = new Map<string, { counts: Record<string, number>; employee: string | null; last: Date | null }>();

  for (const src of SOURCES) {
    const ids = (await src.model.distinct("user")).filter(Boolean).map(String);
    for (const id of ids) {
      if (live.has(id)) continue;
      const row = orphans.get(id) ?? { counts: {}, employee: null, last: null };
      const n = await src.model.countDocuments({ user: id } as never);
      row.counts[src.name] = n;

      // The link deletion severed. Any collection holding both halves has it.
      if (!row.employee && src.pairsEmployee) {
        const doc = await src.model.findOne({ user: id } as never).select("employee").lean<{ employee?: unknown } | null>();
        if (doc?.employee) row.employee = String(doc.employee);
      }
      const recent = await src.model.findOne({ user: id } as never).sort({ createdAt: -1 }).select("createdAt").lean<{ createdAt?: Date } | null>();
      if (recent?.createdAt && (!row.last || recent.createdAt > row.last)) row.last = recent.createdAt;
      orphans.set(id, row);
    }
  }

  if (!orphans.size) {
    console.log("\nNo orphaned user references — no login has been deleted while leaving records behind.");
    await mongoose.disconnect();
    return;
  }

  console.log(`\n━━━ ${orphans.size} deleted login(s) still referenced by records\n`);
  for (const [id, row] of orphans) {
    const total = Object.values(row.counts).reduce((a, b) => a + b, 0);
    console.log(`  ${id}   ${total} record(s)`);
    console.log(`    ${Object.entries(row.counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join("  ") || "(none)"}`);
    if (row.employee) {
      const e = await Employee.findById(row.employee).select("name employeeCode email status user").lean();
      console.log(`    traced to employee: ${e?.name ?? "?"} (${e?.employeeCode ?? "?"}) ${e?.email ?? ""}`);
      console.log(`    that employee's login field is now: ${e?.user ? String(e.user) : "null — severed by the delete"}`);
    } else {
      console.log(`    NOT traceable to an employee — no record pairs this id with one`);
    }
    console.log(`    last activity: ${row.last ? row.last.toISOString().slice(0, 10) : "unknown"}`);
  }

  // Employees left with no login at all — the other side of the same event.
  const noLogin = await Employee.find({ $or: [{ user: null }, { user: { $exists: false } }] })
    .select("name employeeCode email status organization").lean();
  console.log(`\nemployees with no login: ${noLogin.length}`);

  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
