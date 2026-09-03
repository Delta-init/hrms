/**
 * The customer-service teams, each under the mentor who runs it.
 *
 * Seven customer service executives sat in one department with no head, so
 * every leave request and correction went to HR regardless of who actually
 * manages the person. These split them into named teams under the mentor they
 * report to, which is what makes the department-head approval routing reach
 * anybody at all here.
 *
 * The heads are deliberately NOT moved into the teams they lead. They are
 * Academics mentors who run a customer-service team alongside that work, and
 * `Employee.department` holds one value — putting them here would take six
 * mentors out of Academics as a side effect nobody asked for. Note that
 * `DepartmentService.syncEmployeeDepartments` does exactly that, which is why
 * this writes the documents directly rather than going through the service.
 *
 *     bun src/seeds/createCseTeams.ts            # report only
 *     bun src/seeds/createCseTeams.ts --apply
 *
 * Safe to re-run: a team that already exists is updated in place rather than
 * created twice.
 */
import mongoose from "mongoose";
import { connectDB } from "../config/database.js";
import { Department } from "../models/Department.js";
import { Employee } from "../models/Employee.js";
import { Organization } from "../models/Organization.js";

/** Team → the head's employee code, and the members' codes. */
const TEAMS: Array<{ name: string; headCode: string; memberCodes: string[] }> = [
  { name: "CSE-MUJEEB", headCode: "E0017", memberCodes: ["E0161"] }, // Athira Velayudhan
  { name: "CSE-RAGAV",  headCode: "E0016", memberCodes: ["E0059"] }, // Ammu sudarshanan
  { name: "CSE-MIDLAJ", headCode: "E0032", memberCodes: ["E0157"] }, // Jennifer Fernandez
  { name: "CSE-AMJAD",  headCode: "E0062", memberCodes: ["E0172", "E0192"] }, // Alice Antony, Muskan Shaikh
  { name: "CSE-VISHNU", headCode: "E0031", memberCodes: ["E0187"] }, // Ajna Hamza
  { name: "CSE-LIBIN",  headCode: "E0086", memberCodes: ["E0186"] }, // Anuja sabu
];

async function main() {
  const apply = process.argv.includes("--apply");
  await connectDB();
  console.log(`Mode: ${apply ? "APPLY" : "dry run"}\n`);

  const org = await Organization.findOne({ name: /Delta International/i }).select("_id name").lean();
  if (!org) throw new Error("Organisation not found");
  const orgId = org._id;

  // Resolved up front and refused as a set: creating three teams and then
  // discovering the fourth head does not exist would leave the job half done.
  const codes = [...new Set(TEAMS.flatMap((t) => [t.headCode, ...t.memberCodes]))];
  const people = await Employee.find({ organization: orgId, employeeCode: { $in: codes } })
    .select("name employeeCode department")
    .lean();
  const byCode = new Map(people.map((e) => [String(e.employeeCode), e]));
  const missing = codes.filter((c) => !byCode.has(c));
  if (missing.length) throw new Error(`No employee for: ${missing.join(", ")}`);

  const deptNames = new Map(
    (await Department.find({ organization: orgId }).select("name").lean()).map((d) => [String(d._id), d.name])
  );
  const where = (e: { department?: unknown }) => (e.department ? deptNames.get(String(e.department)) ?? "?" : "none");

  for (const t of TEAMS) {
    const head = byCode.get(t.headCode)!;
    const existing = await Department.findOne({ organization: orgId, name: t.name }).lean();
    console.log(`━━━ ${t.name}${existing ? "  (already exists — updating)" : "  (new)"}`);
    console.log(`    head    ${t.headCode} ${head.name}  — stays in ${where(head)}`);
    for (const c of t.memberCodes) {
      const m = byCode.get(c)!;
      console.log(`    member  ${c} ${m.name}  — moves from ${where(m)} → ${t.name}`);
    }

    if (!apply) { console.log(""); continue; }

    const memberIds = t.memberCodes.map((c) => byCode.get(c)!._id);
    const doc = existing
      ? await Department.findByIdAndUpdate(
          existing._id,
          {
            $set: {
              leader: head._id,
              leaderKind: "Employee",
              members: memberIds.map((ref) => ({ kind: "Employee", ref })),
            },
          },
          { new: true }
        )
      : await Department.create({
          organization: orgId,
          name: t.name,
          code: t.name.slice(0, 12),
          description: `Customer service team under ${head.name}`,
          leader: head._id,
          leaderKind: "Employee",
          members: memberIds.map((ref) => ({ kind: "Employee", ref })),
        });

    // Only the members. The head keeps the department they actually belong to.
    await Employee.updateMany({ _id: { $in: memberIds } }, { $set: { department: doc!._id } });
    console.log(`    ✓ written\n`);
  }

  if (!apply) console.log("Dry run — re-run with --apply to write them.");
  else {
    console.log("── after");
    for (const t of TEAMS) {
      const d = await Department.findOne({ organization: orgId, name: t.name }).select("_id name leader").lean();
      const head = await Employee.findById(d?.leader).select("name department").lean();
      const members = await Employee.find({ organization: orgId, department: d?._id }).select("name employeeCode").lean();
      console.log(`   ${String(t.name).padEnd(12)} head=${head?.name}  members=${members.map((m) => m.employeeCode).join(", ") || "none"}`);
    }
    const cse = await Department.findOne({ organization: orgId, name: /customer service/i }).select("_id name").lean();
    const left = await Employee.find({ organization: orgId, department: cse?._id, status: { $ne: "terminated" } }).select("name employeeCode").lean();
    console.log(`   ${String(cse?.name).padEnd(12)} now holds ${left.length}: ${left.map((m) => `${m.employeeCode} ${m.name}`).join(", ") || "nobody"}`);
  }
  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(`\n✗ ${e instanceof Error ? e.message : e}`); await mongoose.disconnect(); process.exit(1); });
