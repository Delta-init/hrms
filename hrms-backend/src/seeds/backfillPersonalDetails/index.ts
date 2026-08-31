import mongoose from "mongoose";
import { env } from "../../config/env.js";
import { Organization } from "../../models/Organization.js";
import { Employee } from "../../models/Employee.js";
import { MigrationJournal, MigrationRun } from "../../models/MigrationJournal.js";
import { readSheet, parseDate, isEmployeeCode, type Row } from "../migrateGreytHR/read.js";

/**
 * Fill in the personal details and bank accounts the import never read.
 *
 * Two files, both of which were sitting in the export folder the whole time.
 * `EmployeeBasicInformation.xlsx` is the one that already turned out to be
 * hiding the joining dates and the birthdays; it also carries gender,
 * nationality, marital status, blood group, personal email and phone for
 * nearly everybody. `EmployeeBankDetails.xlsx` was never referenced at all,
 * which is why not one of a hundred and fifty-nine people has a bank account
 * on file and payroll cannot pay anybody.
 *
 * Blanks only. Anything already recorded is left exactly as it is and reported
 * if it disagrees with the sheet — after the fact there is no way to tell which
 * of two values somebody chose, and a backfill that overwrites is not a
 * backfill.
 *
 * Work email is deliberately not touched. It is the login identity, two people
 * sharing one would collide, and a wrong address locks somebody out of the
 * system entirely — too much to risk on a bulk write for a field nobody is
 * currently blocked by. Pass --emails to include it and see what it would do.
 *
 * Dry by default; `--apply` writes, journalled so the run can be reverted whole.
 *
 *   bun src/seeds/backfillPersonalDetails/index.ts
 *   bun src/seeds/backfillPersonalDetails/index.ts --apply
 */

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const APPLY = args.includes("--apply");
const WITH_EMAILS = args.includes("--emails");
const DIR = (arg("dir") ?? `${process.env.HOME}/Downloads`).replace(/^~/, process.env.HOME ?? "~");
const ORG_NAME = arg("org") ?? "Delta International Management Development Training";

const MIGRATION = "personal-details";
const RUN = `personal-${new Date().toISOString().replace(/[:.]/g, "-")}`;

const log = (s = "") => console.log(s);
const head = (s: string) => { log(); log(`── ${s} ${"─".repeat(Math.max(0, 58 - s.length))}`); };
const t = (v: unknown) => String(v ?? "").trim();

/** "F" / "M" / "O" as the export writes them. */
function gender(v: string): string | null {
  const s = v.trim().toUpperCase();
  return s === "M" ? "male" : s === "F" ? "female" : s === "O" ? "other" : null;
}

/**
 * The model holds only married and unmarried.
 *
 * "Separated" and "Widowed" are neither, and filing them under either would be
 * a small untruth about somebody's life recorded permanently in an HR system.
 * They are left blank and listed instead.
 */
function marital(v: string): string | null {
  const s = v.trim().toLowerCase();
  if (s === "married") return "married";
  if (s === "single" || s === "unmarried") return "unmarried";
  return null;
}

/** "O+ve" and "O+" are the same blood group and must not become two values. */
function blood(v: string): string | null {
  const s = v.trim().toUpperCase().replace(/\s+/g, "").replace(/VE$/, "").replace(/(POS|POSITIVE)$/, "+").replace(/(NEG|NEGATIVE)$/, "-");
  return /^(A|B|AB|O)[+-]$/.test(s) ? s : v.trim() || null;
}

interface Change { code: string; name: string; field: string; value: string }

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const org = await Organization.findOne({ name: ORG_NAME }).lean();
  if (!org) throw new Error(`No organisation named "${ORG_NAME}"`);

  log(`Organisation : ${org.name}`);
  log(`Source       : ${DIR}`);
  log(`Mode         : ${APPLY ? "APPLY — this writes" : "DRY RUN — nothing is written"}`);
  log(`Work email   : ${WITH_EMAILS ? "included (--emails)" : "left alone"}`);

  // ── Read ───────────────────────────────────────────────────────────────────
  const basic = readSheet(DIR, "EmployeeBasicInformation.xlsx");
  const bank = readSheet(DIR, "EmployeeBankDetails.xlsx");
  if (!basic.length) throw new Error("EmployeeBasicInformation.xlsx not found or empty");
  head("Files");
  log(`  EmployeeBasicInformation.xlsx  ${basic.length} rows`);
  log(`  EmployeeBankDetails.xlsx       ${bank.length} rows`);

  // The basic export repeats people; the first row for a code wins.
  const firstBy = (rows: Row[]) => {
    const m = new Map<string, Row>();
    for (const r of rows) {
      const c = t(r["Employee Number"]).toUpperCase();
      if (isEmployeeCode(c) && !m.has(c)) m.set(c, r);
    }
    return m;
  };
  const basicBy = firstBy(basic);
  const bankBy = firstBy(bank);

  const employees = await Employee.find({ organization: org._id }).sort({ employeeCode: 1 });

  const filled: Change[] = [];
  const conflicts: string[] = [];
  const unmapped: string[] = [];
  const perField = new Map<string, number>();
  const touched = new Map<string, Record<string, unknown>>();

  const note = (e: { employeeCode?: string; name?: string }, field: string, value: string) => {
    filled.push({ code: String(e.employeeCode), name: String(e.name), field, value });
    perField.set(field, (perField.get(field) ?? 0) + 1);
  };

  for (const emp of employees) {
    const code = String(emp.employeeCode).toUpperCase();
    const b = basicBy.get(code);
    const k = bankBy.get(code);
    const set: Record<string, unknown> = {};

    if (b) {
      // ── plain scalars ──
      const scalars: Array<[string, string, (v: string) => string | null]> = [
        ["dob", "Date Of Birth", (v) => (parseDate(v) ? v : null)],
        ["gender", "Gender", gender],
        ["nationality", "Nationality", (v) => v || null],
        ["bloodGroup", "Blood Group", blood],
        ["maritalStatus", "Marital Status", marital],
        ["phone", "Phone", (v) => v || null],
        ["personalEmail", "Employee Personal Email", (v) => v.toLowerCase() || null],
        ...(WITH_EMAILS ? ([["email", "Email", (v: string) => v.toLowerCase() || null]] as Array<[string, string, (v: string) => string | null]>) : []),
      ];
      for (const [field, col, parse] of scalars) {
        const raw = t(b[col]);
        if (!raw) continue;
        const value = parse(raw);
        if (value === null) { unmapped.push(`${code} ${field}: "${raw}"`); continue; }
        const current = (emp as unknown as Record<string, unknown>)[field];
        if (current) {
          const same = field === "dob"
            ? new Date(current as Date).toDateString() === parseDate(raw)!.toDateString()
            : String(current).toLowerCase() === String(value).toLowerCase();
          if (!same) conflicts.push(`${code} ${field}: on file "${field === "dob" ? new Date(current as Date).toISOString().slice(0, 10) : current}" · sheet "${value}"`);
          continue;
        }
        set[field] = field === "dob" ? parseDate(raw) : value;
        note(emp, field, field === "dob" ? parseDate(raw)!.toISOString().slice(0, 10) : String(value));
      }
    }

    if (k) {
      // The bank block is one subdocument, so it is built whole and only
      // written where the employee has nothing at all — filling half of
      // somebody's existing account details would be worse than leaving it.
      // The field is `bank`, not `bankDetails`. Writing the wrong path is not
      // an error in Mongoose — it drops the value and saves happily — so the
      // first run of this reported thirty-five accounts written and wrote none.
      const existing = (emp as unknown as { bank?: Record<string, string> }).bank ?? {};
      const hasAny = Object.values(existing).some(Boolean);
      const next: Record<string, string> = {
        bankName: t(k["Bank"]),
        bankAccountNumber: t(k["Bank Account No."]),
        ibanIfsc: t(k["IBAN"]),
        nameInBank: t(k["Name As Per Bank"]),
      };
      const anyValue = Object.values(next).some(Boolean);
      if (anyValue && !hasAny) {
        for (const key of Object.keys(next)) if (!next[key]) delete next[key];
        set.bank = next;
        note(emp, "bank", next.bankAccountNumber || next.ibanIfsc || next.bankName || "—");
      } else if (anyValue && hasAny) {
        conflicts.push(`${code} bank: already on file, sheet has ${next.bankAccountNumber || next.ibanIfsc}`);
      }
    }

    if (Object.keys(set).length) touched.set(String(emp._id), set);
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  head("What would be filled");
  log(`  field                 values`);
  for (const [f, n] of [...perField].sort((a, b) => b[1] - a[1])) log(`  ${f.padEnd(22)} ${String(n).padStart(4)}`);
  log(`  ${"".padEnd(22)} ────`);
  log(`  ${"total".padEnd(22)} ${String(filled.length).padStart(4)}   across ${touched.size} employees`);

  if (unmapped.length) {
    head(`${unmapped.length} values the model cannot hold — left blank`);
    for (const u of unmapped.slice(0, 10)) log(`  ${u}`);
    if (unmapped.length > 10) log(`  … and ${unmapped.length - 10} more`);
  }

  if (conflicts.length) {
    head(`${conflicts.length} where the sheet and the register disagree — left as they are`);
    for (const c of conflicts.slice(0, 12)) log(`  ${c}`);
    if (conflicts.length > 12) log(`  … and ${conflicts.length - 12} more`);
  }

  head("Sample");
  for (const c of filled.slice(0, 10)) log(`  ${c.code.padEnd(8)} ${c.name.slice(0, 24).padEnd(26)} ${c.field.padEnd(18)} ${c.value}`);

  if (!APPLY) {
    head("Nothing was written");
    log(`  re-run with --apply to make these changes`);
    await mongoose.disconnect();
    return;
  }

  // ── Write ──────────────────────────────────────────────────────────────────
  await MigrationRun.create({
    run: RUN, migration: MIGRATION, organization: org._id, organizationName: org.name,
    source: `${DIR}/EmployeeBasicInformation.xlsx + EmployeeBankDetails.xlsx`,
  });
  let written = 0;
  for (const [id, set] of touched) {
    const doc = await Employee.findById(id);
    if (!doc) continue;
    await MigrationJournal.updateOne(
      { run: RUN, collectionName: Employee.collection.name, documentId: doc._id },
      { $setOnInsert: { migration: MIGRATION, before: doc.toObject() } },
      { upsert: true }
    );
    doc.set(set);
    await doc.save();
    // Mongoose drops a path the schema does not have without complaining, which
    // is exactly how the bank block was reported as written and was not. Read
    // one field of what was just set back and refuse to claim success quietly.
    for (const key of Object.keys(set)) {
      if (doc.get(key) === undefined) {
        throw new Error(`"${key}" did not persist on ${doc.employeeCode} — is it a real field on the schema?`);
      }
    }
    written++;
  }
  await MigrationRun.updateOne({ run: RUN }, { finishedAt: new Date(), updated: written, stats: Object.fromEntries(perField) });

  head("Applied");
  log(`  ${filled.length} values across ${written} employees · run ${RUN}`);
  log(`  revert with: bun src/seeds/revertMigration.ts --run=${RUN}`);
  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
