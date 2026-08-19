import mongoose from "mongoose";
import { env } from "../../config/env.js";
import { Organization } from "../../models/Organization.js";
import { Department } from "../../models/Department.js";
import { WorkSchedule } from "../../models/WorkSchedule.js";
import { LeavePolicy } from "../../models/LeavePolicy.js";
import { Employee } from "../../models/Employee.js";
import { User } from "../../models/User.js";
import { Role } from "../../models/Role.js";
import { SalaryIncrement } from "../../models/SalaryIncrement.js";
import { LeaveRequest } from "../../models/LeaveRequest.js";
import { EmploymentHistory } from "../../models/EmploymentHistory.js";
import { Resignation } from "../../models/Resignation.js";
import { LeaveAdjustment } from "../../models/LeaveAdjustment.js";
import { LeaveBalanceService } from "../../services/leaveBalanceService.js";
import { runWithOrg } from "../../utils/orgContext.js";
import { MigrationJournal, MigrationRun } from "../../models/MigrationJournal.js";
import { readSheet, parseDate, parseNumber, normalise, isEmployeeCode, type Row } from "./read.js";

/**
 * Bring a GreytHR export into this system.
 *
 * Dry by default. Nothing is written unless `--apply` is passed, and the dry run
 * prints exactly what would change — because the target is a live database that
 * already holds a third of these people, and "run it and see" is not available.
 *
 * Idempotent throughout: every write is keyed on something natural (employee
 * code, a leave application's employee + dates + type) so a second run corrects
 * rather than duplicates. That matters more than it sounds — an import that
 * cannot be re-run is an import you cannot fix a mistake in.
 *
 * It sends no email. Creating a login through the normal path mails the person
 * a plaintext temporary password, and these addresses are generated from names
 * rather than confirmed — sixty of them may not be real mailboxes yet. Accounts
 * land invited, must-reset, with a password nobody knows, and the activation is
 * sent by hand from the Employees page once the mailbox exists.
 *
 *   bun src/seeds/migrateGreytHR/index.ts --dir=~/Downloads
 *   bun src/seeds/migrateGreytHR/index.ts --dir=~/Downloads --apply
 */

// ── Arguments ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg = (k: string): string | undefined =>
  args.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const APPLY = args.includes("--apply");
const DIR = (arg("dir") ?? `${process.env.HOME}/Downloads`).replace(/^~/, process.env.HOME ?? "~");
const ORG_NAME = arg("org") ?? "Delta International Management Development Training";
const EMAIL_DOMAIN = arg("domain") ?? "deltainstitutions.com";

const SOURCE = "greythr-migration";
const MIGRATION = "greythr";
/** One id for this run — everything it writes is undone together or not at all. */
const RUN = `greythr-${new Date().toISOString().replace(/[:.]/g, "-")}`;

// ── Reporting ────────────────────────────────────────────────────────────────
interface Tally { created: number; updated: number; skipped: number }
const tallies: Record<string, Tally> = {};
const notes: string[] = [];
const warnings: string[] = [];

const tally = (k: string): Tally => (tallies[k] ??= { created: 0, updated: 0, skipped: 0 });
const note = (s: string) => notes.push(s);
const warn = (s: string) => warnings.push(s);

const log = (s = "") => console.log(s);
const head = (s: string) => { log(); log(`── ${s} ${"─".repeat(Math.max(0, 60 - s.length))}`); };

// ── Journal ──────────────────────────────────────────────────────────────────
/**
 * Every document this run touches, recorded once, with what it looked like
 * first. One set guards both helpers, so a document created by this run can
 * never later be snapshotted as though it pre-existed — which is the bug that
 * would make a revert restore a record to a state it was never in.
 */
const journalled = new Set<string>();
let journalCreated = 0;
let journalUpdated = 0;

async function journal(
  model: { collection: { name: string } },
  id: unknown,
  before: Record<string, unknown> | null
): Promise<void> {
  const coll = model.collection.name;
  const key = `${coll}:${String(id)}`;
  if (journalled.has(key)) return;
  journalled.add(key);
  if (before) journalUpdated++; else journalCreated++;
  await MigrationJournal.updateOne(
    { run: RUN, collectionName: coll, documentId: id },
    { $setOnInsert: { migration: MIGRATION, before } },
    { upsert: true }
  );
}

/** Snapshot a document that already existed, before it is changed. */
async function recordBefore(
  model: { collection: { name: string }; findById: (id: unknown) => { lean: () => Promise<unknown> } },
  id: unknown
): Promise<void> {
  const key = `${model.collection.name}:${String(id)}`;
  if (journalled.has(key)) return;
  const before = (await model.findById(id).lean()) as Record<string, unknown> | null;
  await journal(model, id, before);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const code = (r: Row) => (r["Employee Number"] ?? "").trim().toUpperCase();
const nameOf = (r: Row) => (r["Employee Name"] ?? "").trim();

/** Two spellings of the same person are the same person; two people are not. */
const sameName = (a: string, b: string) =>
  a.toLowerCase().replace(/\s+/g, "") === b.toLowerCase().replace(/\s+/g, "");

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  log(`\n${APPLY ? "APPLYING" : "DRY RUN — nothing will be written"}`);
  log(`  source : ${DIR}`);
  log(`  target : ${ORG_NAME}`);

  const org = await Organization.findOne({ name: ORG_NAME });
  if (!org) throw new Error(`No organisation named "${ORG_NAME}"`);
  const orgId = org._id;

  const employeeRole = await Role.findOne({ roleName: "Employee" });
  if (!employeeRole) throw new Error("No 'Employee' role — run the seed first");

  // The header goes down before the first write, not after the last one: a run
  // that dies halfway still has to be revertable, and it is the journal entries
  // written so far that say how far it got.
  if (APPLY) {
    await MigrationRun.create({
      run: RUN, migration: MIGRATION, organization: orgId,
      organizationName: org.name, source: DIR,
    });
    log(`  run id : ${RUN}`);
  }

  // ── Load ───────────────────────────────────────────────────────────────────
  const sheets = {
    visa: readSheet(DIR, "VisaDetails.xlsx"),
    visaAlt: readSheet(DIR, "VisaDetails (1).xlsx"),
    category: readSheet(DIR, "CurrentEmployeeCategory.xlsx"),
    categoryList: readSheet(DIR, "employeecategorylist.xlsx"),
    previous: readSheet(DIR, "previousemployees (1).xlsx"),
    orgTree: readSheet(DIR, "orgtreehistory.xlsx"),
    cards: readSheet(DIR, "CurrentCardDetails.xlsx"),
    address: readSheet(DIR, "employeepermanentaddress.xlsx"),
    emergency: readSheet(DIR, "employeeemergencycontacts.xlsx"),
    qualifications: readSheet(DIR, "qualificationdetails.xlsx"),
    salary: readSheet(DIR, "latestsalaryrevision.xlsx"),
    leave: readSheet(DIR, "leaveinfo.xlsx"),
    balance: readSheet(DIR, "leavebalance.xlsx"),
    currentBalance: readSheet(DIR, "leavedetails.xlsx"),
    yearBalance: readSheet(DIR, "yearwiseleavebalance.xlsx"),
    resignations: readSheet(DIR, "ResignationDetails.xlsx"),
  };
  head("Files read");
  for (const [k, v] of Object.entries(sheets)) log(`  ${k.padEnd(16)} ${String(v.length).padStart(5)} rows`);

  // ── Roster ─────────────────────────────────────────────────────────────────
  interface Person { code: string; name: string; joined: Date | null; row: Row }
  const roster = new Map<string, Person>();
  for (const r of sheets.visa) {
    const c = code(r);
    if (isEmployeeCode(c) && nameOf(r)) roster.set(c, { code: c, name: nameOf(r), joined: parseDate(r["Joined On"]), row: r });
  }
  for (const r of sheets.category) {
    const c = code(r);
    if (!isEmployeeCode(c) || !nameOf(r)) continue;
    const p = roster.get(c);
    if (p) { p.row = { ...p.row, ...r }; }
    else roster.set(c, { code: c, name: nameOf(r), joined: null, row: r });
  }
  log(`\n  ${roster.size} people in the export`);

  // ── Reference data ─────────────────────────────────────────────────────────
  head("Departments");
  const existingDepts = await Department.find({ organization: orgId });
  const deptByNorm = new Map(existingDepts.map((d) => [normalise(d.name), d]));
  const wantedDepts = new Set<string>();
  for (const r of sheets.category) if (r["Curr.Department"]) wantedDepts.add(r["Curr.Department"]);
  for (const r of sheets.categoryList) if (r["Category Type"] === "Department" && r["Category Value"]) wantedDepts.add(r["Category Value"]);

  for (const dn of [...wantedDepts].sort()) {
    const key = normalise(dn);
    if (deptByNorm.has(key)) { tally("departments").skipped++; continue; }
    tally("departments").created++;
    note(`department + ${dn}`);
    if (APPLY) {
      const d = await Department.create({ organization: orgId, name: dn });
      await journal(Department, d._id, null);
      deptByNorm.set(key, d);
    }
  }
  log(`  ${wantedDepts.size} in export · ${tally("departments").created} new · ${tally("departments").skipped} matched existing`);

  head("Shifts");
  const shiftNames = new Set<string>();
  for (const r of sheets.category) if (r["Curr.Shift"]) shiftNames.add(r["Curr.Shift"]);
  const existingSchedules = await WorkSchedule.find({ organization: orgId });
  const schedByNorm = new Map(existingSchedules.map((s) => [normalise(s.name), s]));
  /** "11:30am - 8:30pm" → 11:30 / 20:30. Anything unparseable keeps the default. */
  const parseShift = (label: string): { login: string; logout: string } | null => {
    const m = label.match(/(\d{1,2})[:.](\d{2})\s*(am|pm)?\s*(?:to|-|–)\s*(\d{1,2})[:.](\d{2})\s*(am|pm)?/i);
    if (!m) return null;
    const to24 = (h: string, min: string, ap?: string) => {
      let hh = Number(h);
      if (ap?.toLowerCase() === "pm" && hh < 12) hh += 12;
      if (ap?.toLowerCase() === "am" && hh === 12) hh = 0;
      return `${String(hh).padStart(2, "0")}:${min}`;
    };
    return { login: to24(m[1], m[2], m[3]), logout: to24(m[4], m[5], m[6] ?? "pm") };
  };
  for (const s of [...shiftNames].sort()) {
    if (schedByNorm.has(normalise(s))) { tally("shifts").skipped++; continue; }
    const t = parseShift(s);
    tally("shifts").created++;
    note(`shift + ${s}${t ? ` (${t.login}–${t.logout})` : " (times unreadable — defaults kept)"}`);
    if (APPLY) {
      const ws = await WorkSchedule.create({
        organization: orgId, name: s.slice(0, 80), timeZone: "Asia/Dubai",
        ...(t ? { loginTime: t.login, logoutTime: t.logout } : {}),
      });
      await journal(WorkSchedule, ws._id, null);
      schedByNorm.set(normalise(s), ws);
    }
  }
  log(`  ${shiftNames.size} in export · ${tally("shifts").created} new · ${tally("shifts").skipped} matched existing`);

  head("Leave policies");
  const LEAVE_MAP: Record<string, { type: string; label: string; paid: boolean; days: number }> = {
    "Annual Leave": { type: "annual", label: "Annual Leave", paid: true, days: 30 },
    "Sick Leave": { type: "sick", label: "Sick Leave", paid: true, days: 15 },
    "Unpaid Leave": { type: "unpaid", label: "Unpaid Leave", paid: false, days: 0 },
    "Compensatory Off": { type: "comp_off", label: "Compensatory Off", paid: true, days: 0 },
  };
  const existingPolicies = await LeavePolicy.find({ organization: orgId });
  const policyByType = new Map(existingPolicies.map((p) => [p.type, p]));
  for (const [sheetName, spec] of Object.entries(LEAVE_MAP)) {
    if (policyByType.has(spec.type)) { tally("leavePolicies").skipped++; continue; }
    tally("leavePolicies").created++;
    note(`leave policy + ${spec.label} (${spec.type}, ${spec.days} days, ${spec.paid ? "paid" : "unpaid"}) — entitlement is a guess, check it`);
    if (APPLY) {
      const p = await LeavePolicy.create({
        organization: orgId, type: spec.type, label: spec.label,
        days: spec.days, paid: spec.paid, period: "year",
      });
      await journal(LeavePolicy, p._id, null);
      policyByType.set(spec.type, p);
    }
    void sheetName;
  }
  log(`  ${Object.keys(LEAVE_MAP).length} leave types in export · ${tally("leavePolicies").created} new`);

  // ── Employees ──────────────────────────────────────────────────────────────
  head("Employees");
  const existing = await Employee.find({ organization: orgId });
  const byCode = new Map(existing.map((e) => [e.employeeCode.toUpperCase(), e]));
  const allEmails = new Set(
    (await Employee.find({}).select("email")).map((e) => (e.email ?? "").toLowerCase()).filter(Boolean)
  );
  for (const u of await User.find({}).select("email")) allEmails.add((u.email ?? "").toLowerCase());

  /**
   * First name at the company domain, matching what is already in use
   * (safeer@, muhassin@, nafiz@). On a clash, add surname letters, then a digit
   * — never silently reuse, because two people sharing a login is worse than an
   * ugly address.
   */
  function makeEmail(fullName: string): string {
    const parts = fullName.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
    const first = parts[0] ?? "user";
    const rest = parts.slice(1).join("");
    const candidates = [first, first + (rest[0] ?? ""), first + rest.slice(0, 3), first + rest];
    for (const c of candidates) {
      const e = `${c}@${EMAIL_DOMAIN}`;
      if (c && !allEmails.has(e)) { allEmails.add(e); return e; }
    }
    let n = 2;
    for (;;) {
      const e = `${first}${n}@${EMAIL_DOMAIN}`;
      if (!allEmails.has(e)) { allEmails.add(e); return e; }
      n++;
    }
  }

  const LOCATION: Record<string, string> = { dubai: "dubai", india: "india" };
  const employeeIdByCode = new Map<string, mongoose.Types.ObjectId>();
  const conflicts: string[] = [];

  for (const p of [...roster.values()].sort((a, b) => a.code.localeCompare(b.code))) {
    const r = p.row;
    const dept = r["Curr.Department"] ? deptByNorm.get(normalise(r["Curr.Department"])) : null;
    const sched = r["Curr.Shift"] ? schedByNorm.get(normalise(r["Curr.Shift"])) : null;
    const fields: Record<string, unknown> = {
      name: p.name,
      organization: orgId,
      joiningDate: p.joined,
      designation: r["Curr.Designation"] || undefined,
      department: dept?._id ?? null,
      workSchedule: sched?._id ?? null,
      location: LOCATION[(r["Curr.Location"] ?? "").toLowerCase()],
      currency: (r["Curr.Currency"] || "AED").toUpperCase(),
      status: (r["Has Left The Organization?"] ?? "No").toLowerCase() === "yes" ? "terminated" : "active",
    };
    for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];

    const found = byCode.get(p.code);
    if (!found) {
      tally("employees").created++;
      if (APPLY) {
        const created = await Employee.create({ employeeCode: p.code, email: makeEmail(p.name), ...fields });
        await journal(Employee, created._id, null);
        byCode.set(p.code, created);
        employeeIdByCode.set(p.code, created._id as mongoose.Types.ObjectId);
      }
      continue;
    }

    employeeIdByCode.set(p.code, found._id as mongoose.Types.ObjectId);
    if (!sameName(found.name, p.name)) {
      // Same code, different person. The export is authoritative, but the login
      // sitting on the old record belongs to a real human — it is left alone and
      // detached rather than renamed out from under them.
      conflicts.push(`${p.code}: was "${found.name}" <${found.email}> → now "${p.name}" (login detached, not deleted)`);
      fields.user = null;
      fields.email = makeEmail(p.name);
    }
    tally("employees").updated++;
    if (APPLY) {
      await recordBefore(Employee, found._id);
      await Employee.updateOne({ _id: found._id }, { $set: fields });
    }
  }
  log(`  ${tally("employees").created} to create · ${tally("employees").updated} to enrich`);
  for (const c of conflicts) warn(`identity conflict — ${c}`);

  // A dry run creates nobody, so it has no ids to hang the rest on. Counting
  // against the roster instead keeps the preview's numbers honest — otherwise
  // every later phase reports "skipped" for the 65 people not yet created.
  const known = new Set([...roster.keys(), ...byCode.keys()]);
  const resolves = (c: string) => known.has(c);

  await logins();
  await detail();
  await history();
  await salary();
  await leave();
  await resignations();
  await balances();

  // ── Logins ─────────────────────────────────────────────────────────────────
  /**
   * A login for everybody, and not one email sent.
   *
   * The normal path mails a plaintext temporary password on creation. These
   * addresses are generated from names rather than confirmed, so sixty of them
   * may not be real mailboxes — mailing them would leak credentials to whatever
   * the domain does with unknown recipients. Accounts are created invited, with
   * a random password nobody holds, and activation is sent by hand later.
   */
  async function logins() {
    head("Logins");
    for (const p of roster.values()) {
      const emp = byCode.get(p.code);
      if (emp?.user) { tally("logins").skipped++; continue; }
      // Counted even when the employee does not exist yet: on a real run they
      // were created moments ago, and a preview that says 26 when the answer is
      // 92 is worse than no preview.
      tally("logins").created++;
      if (!APPLY || !emp) continue;
      const email = (emp.email ?? "").toLowerCase();
      if (!email) { tally("logins").skipped++; continue; }
      const already = await User.findOne({ email });
      if (already) await journal(User, already._id, already.toObject() as unknown as Record<string, unknown>);
      const user = already ?? await User.create({
        name: emp.name, email,
        // Never used to sign in: the account is invited and must reset.
        password: `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}A1!`,
        role: employeeRole!._id, organization: orgId,
        designation: emp.designation, workSchedule: emp.workSchedule ?? null,
        status: "invited", mustResetPassword: true,
      });
      if (!already) await journal(User, user._id, null);
      await recordBefore(Employee, emp._id);
      await Employee.updateOne({ _id: emp._id }, { $set: { user: user._id } });
      emp.user = user._id as never;
    }
    log(`  ${tally("logins").created} logins to create · ${tally("logins").skipped} already had one`);
    note("no activation emails are sent — send them from the Employees page once the mailboxes exist");
  }

  // ── Per-employee detail ────────────────────────────────────────────────────
  async function detail() {
    head("Visas, cards, addresses, contacts, qualifications");

    const idFor = (c: string) =>
      employeeIdByCode.get(c) ?? byCode.get(c)?._id ?? (resolves(c) ? ("pending" as unknown as mongoose.Types.ObjectId) : undefined);

    // Visa — the export has two views of it; the fuller one wins.
    const visaRows = [...sheets.visa, ...sheets.visaAlt];
    const visas = new Map<string, Row>();
    for (const r of visaRows) {
      const c = code(r);
      if (c && r["Current Visa No"]) visas.set(c, r);
    }
    for (const [c, r] of visas) {
      const id = idFor(c);
      if (!id) { tally("visa").skipped++; continue; }
      tally("visa").updated++;
      if (APPLY) await recordBefore(Employee, id);
      if (APPLY) await Employee.updateOne({ _id: id }, {
        $set: { visa: {
          country: r["Current Visa Country"] || undefined,
          type: r["Current Visa Type"] || undefined,
          issueDate: parseDate(r["Current Visa IssueDate"]),
          expiryDate: parseDate(r["Current Visa Valid Till"]),
        } },
      });
    }

    // Cards. Four of the eight types carry one number shared by everybody —
    // those are the company's trade licence and Ejari, not the person's, and
    // filing them on 98 employees would be wrong.
    const perType = new Map<string, Set<string>>();
    for (const r of sheets.cards) {
      const t = r["Current Card Type"];
      const n = r["Current Card Number"];
      if (t && n) (perType.get(t) ?? perType.set(t, new Set()).get(t)!).add(n);
    }
    const companyWide = [...perType.entries()].filter(([, v]) => v.size <= 1).map(([t]) => t);
    if (companyWide.length) note(`company-wide documents skipped (one number shared by everyone): ${companyWide.join(", ")}`);

    const byEmployee = new Map<string, Row[]>();
    for (const r of sheets.cards) {
      const c = code(r);
      const t = r["Current Card Type"];
      if (!c || !t || companyWide.includes(t) || !r["Current Card Number"]) continue;
      (byEmployee.get(c) ?? byEmployee.set(c, []).get(c)!).push(r);
    }
    for (const [c, rows] of byEmployee) {
      const id = idFor(c);
      if (!id) { tally("cards").skipped++; continue; }
      const labour = rows.find((r) => /labour/i.test(r["Current Card Type"]));
      const others = rows.filter((r) => r !== labour).map((r) => ({
        label: r["Current Card Type"].slice(0, 120),
        number: r["Current Card Number"].slice(0, 60),
        issueDate: parseDate(r["Current Card Issue Date"]),
        expiryDate: parseDate(r["Current Card Expiry Date"]),
        notes: r["Current Card Personal Number"] ? `Personal no: ${r["Current Card Personal Number"]}` : undefined,
      }));
      tally("cards").updated++;
      if (APPLY) {
        await recordBefore(Employee, id);
        await Employee.updateOne({ _id: id }, {
          $set: {
            ...(labour ? { labourCard: {
              cardNumber: labour["Current Card Number"],
              issueDate: parseDate(labour["Current Card Issue Date"]),
              expiryDate: parseDate(labour["Current Card Expiry Date"]),
            } } : {}),
            otherDocuments: others,
          },
        });
      }
    }

    // Permanent address
    for (const r of sheets.address) {
      const c = code(r);
      const id = c ? idFor(c) : null;
      const line = [r["Permanent Address Line-1"], r["Permanent Address Line-2"], r["Permanent Address Line-3"]]
        .filter(Boolean).join(", ");
      if (!id || (!line && !r["Permanent City"] && !r["Permanent Phone No"])) { tally("addresses").skipped++; continue; }
      tally("addresses").updated++;
      if (APPLY) await recordBefore(Employee, id);
      if (APPLY) await Employee.updateOne({ _id: id }, {
        $set: {
          permanentAddress: {
            address: line || undefined, city: r["Permanent City"] || undefined,
            state: r["Permanent State"] || undefined, country: r["Permanent Country"] || undefined,
          },
          ...(r["Permanent Phone No"] ? { phone: r["Permanent Phone No"].slice(0, 30) } : {}),
        },
      });
    }

    // Emergency contacts
    for (const r of sheets.emergency) {
      const c = code(r);
      const id = c ? idFor(c) : null;
      if (!id || !r["Emergency Contact Name"]) { tally("emergency").skipped++; continue; }
      tally("emergency").updated++;
      if (APPLY) await recordBefore(Employee, id);
      if (APPLY) await Employee.updateOne({ _id: id }, {
        $set: { emergencyContacts: [{
          name: r["Emergency Contact Name"], relation: r["Emergency Contact Relation"] || undefined,
          phoneNumber: r["Emergency Contact Number"] || r["Emergency Contact Phone No"] || undefined,
          email: r["Emergency Contact Email"] || undefined,
          city: r["Emergency Contact City"] || undefined,
          country: r["Emergency Contact Country"] || undefined,
          address: [r["Emergency Contact Address Line-1"], r["Emergency Contact Address Line-2"]].filter(Boolean).join(", ") || undefined,
        }] },
      });
    }

    // Qualifications
    const quals = new Map<string, Array<Record<string, string | undefined>>>();
    for (const r of sheets.qualifications) {
      const c = code(r);
      if (!c || !r["Qualification"]) continue;
      (quals.get(c) ?? quals.set(c, []).get(c)!).push({
        qualification: r["Qualification"],
        institute: r["Institute"] || undefined,
        from: r["Start Year"]?.replace(/\.0$/, "") || undefined,
        to: r["Qual Year To"]?.replace(/\.0$/, "") || undefined,
      });
    }
    for (const [c, list] of quals) {
      const id = idFor(c);
      if (!id) { tally("education").skipped++; continue; }
      tally("education").updated++;
      if (APPLY) { await recordBefore(Employee, id); await Employee.updateOne({ _id: id }, { $set: { education: list } }); }
    }

    // Reporting line — the open row in the org tree is the current manager.
    const current = sheets.orgTree.filter((r) => !r["Reported Till"] && r["Manager Employee Number"]);
    for (const r of current) {
      const id = idFor(code(r));
      const managerId = idFor((r["Manager Employee Number"] ?? "").toUpperCase());
      if (!id || !managerId || String(id) === String(managerId)) { tally("reporting").skipped++; continue; }
      tally("reporting").updated++;
      if (APPLY) { await recordBefore(Employee, id); await Employee.updateOne({ _id: id }, { $set: { reportingTo: managerId, reportingToKind: "Employee" } }); }
    }

    for (const k of ["visa", "cards", "addresses", "emergency", "education", "reporting"]) {
      const t = tally(k);
      log(`  ${k.padEnd(12)} ${String(t.updated).padStart(4)} set · ${t.skipped} skipped`);
    }
  }

  // ── History ────────────────────────────────────────────────────────────────
  async function history() {
    head("Employment history");
    const KIND: Record<string, string> = {
      Company: "company", Department: "department", Designation: "designation",
      Location: "location", Shift: "shift", Currency: "currency", Team: "team",
      Weekoff: "weekoff", Biometric: "biometric", "Desktop access": "desktopAccess",
    };
    const rows: Array<{ code: string; kind: string; value: string; from: Date; to: Date | null }> = [];

    for (const r of sheets.categoryList) {
      const kind = KIND[r["Category Type"]];
      const from = parseDate(r["From"]);
      if (!kind || !from || !r["Category Value"]) continue;
      rows.push({ code: code(r), kind, value: r["Category Value"], from, to: parseDate(r["To"]) });
    }
    // The "previous" sheet is the same shape with one column pair per kind.
    for (const r of sheets.previous) {
      for (const [label, kind] of Object.entries(KIND)) {
        const value = r[`Prev.${label}`];
        const from = parseDate(r[`Prev.${label} Since`]);
        if (!value || !from) continue;
        rows.push({ code: code(r), kind, value, from, to: parseDate(r[`Prev.${label} Till`]) });
      }
    }
    for (const r of sheets.orgTree) {
      const from = parseDate(r["Reporting From"]);
      if (!from || !r["Manager Name"]) continue;
      rows.push({ code: code(r), kind: "manager", value: r["Manager Name"], from, to: parseDate(r["Reported Till"]) });
    }

    const managerCodeByName = new Map<string, string>();
    for (const r of sheets.orgTree) {
      if (r["Manager Name"] && r["Manager Employee Number"]) {
        managerCodeByName.set(r["Manager Name"], r["Manager Employee Number"].toUpperCase());
      }
    }

    for (const h of rows) {
      const employeeId = employeeIdByCode.get(h.code) ?? byCode.get(h.code)?._id;
      if (!employeeId && !resolves(h.code)) { tally("history").skipped++; continue; }
      tally("history").created++;
      if (!APPLY || !employeeId) continue;
      const managerId = h.kind === "manager"
        ? employeeIdByCode.get(managerCodeByName.get(h.value) ?? "") ?? byCode.get(managerCodeByName.get(h.value) ?? "")?._id ?? null
        : null;
      const deptId = h.kind === "department" ? deptByNorm.get(normalise(h.value))?._id ?? null : null;
      const key = { organization: orgId, employee: employeeId, kind: h.kind, value: h.value, from: h.from };
      const had = await EmploymentHistory.findOne(key).lean();
      const saved = await EmploymentHistory.findOneAndUpdate(
        key,
        { $set: { to: h.to, source: SOURCE, manager: managerId, department: deptId } },
        { upsert: true, new: true }
      );
      await journal(EmploymentHistory, saved!._id, (had as Record<string, unknown> | null) ?? null);
    }
    log(`  ${tally("history").created} history rows · ${tally("history").skipped} for unknown employees`);
  }

  // ── Salary ─────────────────────────────────────────────────────────────────
  async function salary() {
    head("Salary");
    for (const r of sheets.salary) {
      const c = code(r);
      const id = employeeIdByCode.get(c) ?? byCode.get(c)?._id;
      const ctc = parseNumber(r["CTC Value"]);
      const effective = parseDate(r["Effective Date"]);
      if ((!id && !resolves(c)) || ctc === null || ctc <= 0 || !effective) { tally("salary").skipped++; continue; }
      tally("salary").updated++;
      if (!APPLY || !id) continue;
      const before = byCode.get(c)?.salary ?? 0;
      await recordBefore(Employee, id);
      await Employee.updateOne({ _id: id }, { $set: { salary: ctc } });
      const incKey = { organization: orgId, employee: id, effectiveMonth: monthKey(effective) };
      const hadInc = await SalaryIncrement.findOne(incKey).lean();
      const inc = await SalaryIncrement.findOneAndUpdate(
        incKey,
        { $set: {
          previousSalary: before, newSalary: ctc,
          reason: `Imported from GreytHR${r["Increment Percentage(%)"] ? ` (${r["Increment Percentage(%)"]}%)` : ""}`,
        } },
        { upsert: true, new: true }
      );
      await journal(SalaryIncrement, inc!._id, (hadInc as Record<string, unknown> | null) ?? null);
    }
    log(`  ${tally("salary").updated} salaries set · ${tally("salary").skipped} skipped (no CTC, or unknown employee)`);
  }

  // ── Leave ──────────────────────────────────────────────────────────────────
  async function leave() {
    head("Leave");
    const STATUS: Record<string, string> = {
      "Availed": "approved", "Application - Avail": "pending",
      "Rejected": "rejected", "Withdrawn": "cancelled", "Cancelled": "cancelled",
    };
    const TYPE: Record<string, string> = {
      "Annual Leave": "annual", "Sick Leave": "sick",
      "Unpaid Leave": "unpaid", "Compensatory Off": "comp_off",
    };
    const ledgerOnly = new Set(["Granted", "Lapsed", "Closing Balance"]);

    let noUser = 0;
    for (const r of sheets.leave) {
      const txn = r["Leave Transaction Type"];
      if (!txn || ledgerOnly.has(txn)) { tally("leave").skipped++; continue; }
      const status = STATUS[txn];
      const type = TYPE[r["Leave Type"]];
      const from = parseDate(r["From Date"]);
      const to = parseDate(r["To Date"]);
      if (!status || !type || !from || !to) { tally("leave").skipped++; continue; }

      const c = code(r);
      const emp = byCode.get(c);
      // LeaveRequest hangs off the login account, not the employee record, so
      // anybody without one cannot carry their history across.
      if (!emp?.user) { noUser++; tally("leave").skipped++; continue; }

      tally("leave").created++;
      if (!APPLY) continue;
      const lvKey = { organization: orgId, user: emp.user, type, startDate: from, endDate: to };
      const hadLv = await LeaveRequest.findOne(lvKey).lean();
      const lv = await LeaveRequest.findOneAndUpdate(
        lvKey,
        { $set: {
          days: Math.abs(parseNumber(r["Days"]) ?? 1),
          reason: (r["Reason"] || "Imported from GreytHR").slice(0, 500),
          timeZone: "Asia/Dubai", status,
          reviewNote: r["Remarks"] ? r["Remarks"].slice(0, 500) : undefined,
          reviewedAt: parseDate(r["Approved Date"]),
        } },
        { upsert: true, new: true }
      );
      await journal(LeaveRequest, lv!._id, (hadLv as Record<string, unknown> | null) ?? null);
    }
    log(`  ${tally("leave").created} leave records · ${tally("leave").skipped} skipped`);
    if (noUser) {
      warn(APPLY
        ? `${noUser} leave records skipped — those employees still have no login. Re-run to pick them up.`
        : `${noUser} leave records look unassignable in this preview only: leave hangs off the login account, and in a dry run no logins exist yet. A real run creates them first, so the real number will be far lower.`);
    }
  }

  // ── Resignations ───────────────────────────────────────────────────────────
  /**
   * The people who have already left.
   *
   * The first export carried none of this — every row was blank — so everybody
   * came across active. This one names sixty leavers with real dates, which
   * matters beyond tidiness: an active employee is on the payroll roster.
   *
   * Written as an accepted resignation plus a terminated employee, because that
   * is the state a completed exit leaves behind. It does not run the normal
   * review path: that would email people about a decision taken years ago.
   */
  async function resignations() {
    head("Resignations");
    const MODE: Record<string, string> = {
      RESIGNED: "resignation", TERMINATED: "termination",
      ABSCONDING: "absconding", TRANSFERRED: "resignation", RETIRED: "retirement",
    };
    let created = 0;
    for (const r of sheets.resignations) {
      const c = code(r);
      const leaving = parseDate(r["Leaving Date"]);
      if (!leaving || !isEmployeeCode(c)) { tally("resignations").skipped++; continue; }

      /**
       * Every leaver here is somebody the system has never heard of.
       *
       * The roster exports list current staff only, so none of these sixty were
       * imported and no other sheet mentions them — not leave, not documents,
       * not even a joining date. The record that gets created is therefore
       * thin: a name, a code, and the day they left.
       *
       * Still worth having. Without it the answer to "did this person work
       * here" is silence, and a headcount that has never lost anybody is wrong
       * in a way nobody notices.
       */
      let emp = byCode.get(c);
      if (!emp) {
        created++;
        if (!APPLY) { tally("resignations").created++; continue; }
        emp = await Employee.create({
          employeeCode: c, name: nameOf(r) || c, organization: orgId, status: "terminated",
        });
        await journal(Employee, emp._id, null);
        byCode.set(c, emp);
      }

      tally("resignations").created++;
      if (!APPLY) continue;
      const key = { organization: orgId, employee: emp._id };
      const had = await Resignation.findOne(key).lean();
      const saved = await Resignation.findOneAndUpdate(
        key,
        { $set: {
          // Submission date is often blank on an old record; the leaving date
          // is the one thing every row has, so it stands in rather than today.
          resignationDate: parseDate(r["Submission Date"]) ?? leaving,
          lastWorkingDay: leaving,
          type: MODE[(r["Separation Mode"] ?? "").toUpperCase()] ?? "resignation",
          reason: (r["Leaving Reason"] || r["Separation Mode"] || "Imported from GreytHR").slice(0, 500),
          status: "relieved",
          reviewNote: r["Remarks"] ? String(r["Remarks"]).slice(0, 500) : undefined,
          noticePeriodDays: parseNumber(r["Notice Period"]) ?? 0,
        } },
        { upsert: true, new: true }
      );
      await journal(Resignation, saved!._id, (had as Record<string, unknown> | null) ?? null);
      await recordBefore(Employee, emp._id);
      await Employee.updateOne({ _id: emp._id }, { $set: { status: "terminated" } });
    }
    log(`  ${tally("resignations").created} leavers recorded · ${tally("resignations").skipped} rows with no leaving date`);
    if (created) {
      note(`${created} leavers created from scratch — no other export mentions them, so the records hold only a name, a code and a leaving date`);
    }
    if (tally("resignations").created) {
      note(`${tally("resignations").created} employees marked terminated — they are off the payroll roster`);
    }
  }

  // ── Leave balances ─────────────────────────────────────────────────────────
  /**
   * Make the balances agree with what people were told they had.
   *
   * Balances here are computed — accrued plus carried minus used — so there is
   * nothing to paste a figure into. What gets written is the *difference*
   * between GreytHR's number and what this system works out on its own.
   * Writing the figure itself would double it against our own accrual.
   *
   * The effect is that everybody's balance matches their old one on the day of
   * the cutover and behaves by these rules afterwards, with a row on the record
   * saying where the difference came from.
   */
  async function balances() {
    head("Leave balances");
    const TYPE: Record<string, string> = {
      "Annual Leave": "annual", "Sick Leave": "sick",
      "Unpaid Leave": "unpaid", "Compensatory Off": "comp_off",
    };
    const year = new Date().getUTCFullYear();
    const service = new LeaveBalanceService();

    // Group the export's figures per person, so one computeBalances call
    // answers every leave type they hold.
    const wanted = new Map<string, Map<string, number>>();
    for (const r of sheets.currentBalance) {
      const c = code(r);
      const type = TYPE[r["Leave Type"]];
      const days = parseNumber(r["Balance Days"]);
      if (!c || !type || days === null) { tally("balances").skipped++; continue; }
      (wanted.get(c) ?? wanted.set(c, new Map()).get(c)!).set(type, days);
    }

    let overdrawn = 0;
    for (const [c, byType] of wanted) {
      const emp = byCode.get(c);
      if (!emp?.user) { tally("balances").skipped += byType.size; continue; }
      for (const days of byType.values()) if (days < 0) overdrawn++;
      tally("balances").created += byType.size;
      if (!APPLY) continue;

      // computeBalances resolves policies through the org context, which a
      // script has none of until it is given one.
      const computed = await new Promise<Awaited<ReturnType<typeof service.computeBalances>>>((resolve, reject) => {
        runWithOrg({ orgId: String(orgId), isSuperAdmin: true }, () => {
          service.computeBalances(String(emp.user), year).then(resolve, reject);
        });
      });
      const ours = new Map(computed.map((b) => [b.type, b.balance]));

      for (const [type, target] of byType) {
        // Their existing adjustment is already inside `ours`, so it has to come
        // back out — otherwise every re-run adds the gap a second time.
        const existing = await LeaveAdjustment.findOne({
          organization: orgId, user: emp.user, type, year, source: SOURCE,
        }).lean();
        const withoutOurs = (ours.get(type) ?? 0) - (existing?.days ?? 0);
        const delta = Math.round((target - withoutOurs) * 100) / 100;

        const had = existing;
        const saved = await LeaveAdjustment.findOneAndUpdate(
          { organization: orgId, user: emp.user, type, year, source: SOURCE },
          { $set: { days: delta, reason: `Opening balance carried over from GreytHR (${target} days)` } },
          { upsert: true, new: true }
        );
        await journal(LeaveAdjustment, saved!._id, (had as Record<string, unknown> | null) ?? null);
      }
    }
    log(`  ${tally("balances").created} balances set · ${tally("balances").skipped} skipped (no login, or unreadable)`);
    if (overdrawn) note(`${overdrawn} of these balances are negative in GreytHR — imported as-is, not clamped to zero`);
    log(`  ${sheets.yearBalance.length} year-wise rows are not imported: only the current year's balance has a home.`);
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  head("Summary");
  for (const [k, t] of Object.entries(tallies)) {
    log(`  ${k.padEnd(16)} create ${String(t.created).padStart(5)} · update ${String(t.updated).padStart(5)} · skip ${String(t.skipped).padStart(5)}`);
  }
  if (notes.length) {
    head(`Notes (${notes.length})`);
    for (const n of notes.slice(0, 40)) log(`  · ${n}`);
    if (notes.length > 40) log(`  … and ${notes.length - 40} more`);
  }
  if (warnings.length) {
    head(`Needs your attention (${warnings.length})`);
    for (const w of warnings) log(`  ! ${w}`);
  }
  if (APPLY) {
    await MigrationRun.updateOne(
      { run: RUN },
      { $set: { finishedAt: new Date(), stats: tallies, created: journalCreated, updated: journalUpdated } }
    );
    log(`\nApplied. ${journalCreated} documents created, ${journalUpdated} changed.`);
    log(`Undo it with:  bun run migrate:greythr:revert -- --run=${RUN}\n`);
  } else {
    log(`\nNothing was written. Re-run with --apply to commit.\n`);
  }

  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error("\nMigration failed:", e);
  await mongoose.disconnect();
  process.exit(1);
});
