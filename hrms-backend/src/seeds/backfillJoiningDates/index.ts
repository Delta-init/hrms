import mongoose from "mongoose";
import { env } from "../../config/env.js";
import { Organization } from "../../models/Organization.js";
import { Employee } from "../../models/Employee.js";
import { MigrationJournal, MigrationRun } from "../../models/MigrationJournal.js";
import { readSheet, parseDate, isEmployeeCode, type Row } from "../migrateGreytHR/read.js";

/**
 * Give everybody back the date they joined.
 *
 * The GreytHR import meant to carry it and read the column off the visa sheet,
 * which has no such column — so `parseDate(undefined)` returned null for all 98
 * people and the field was quietly left empty. Nothing errored, which is why it
 * went unnoticed until somebody asked.
 *
 * The dates were in EmployeeBasicInformation.xlsx the whole time. This reads
 * them back and fills the gap.
 *
 * It only ever fills a blank. Anybody whose joining date has since been set by
 * hand is left alone — a backfill that overwrites is not a backfill, and there
 * is no way to tell afterwards which of the two dates somebody chose.
 *
 * Dry by default; `--apply` writes, journalled so the run can be reverted whole.
 *
 *   bun src/seeds/backfillJoiningDates/index.ts
 *   bun src/seeds/backfillJoiningDates/index.ts --apply
 */

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const APPLY = args.includes("--apply");
const OVERWRITE = args.includes("--overwrite");
const DIR = (arg("dir") ?? `${process.env.HOME}/Downloads`).replace(/^~/, process.env.HOME ?? "~");
const FILE = arg("file") ?? "EmployeeBasicInformation.xlsx";
const ORG_NAME = arg("org") ?? "Delta International Management Development Training";

const MIGRATION = "joining-dates";
const RUN = `joined-${new Date().toISOString().replace(/[:.]/g, "-")}`;

/** The export's own column names, matching how the GreytHR import reads them. */
const code = (r: Row) => (r["Employee Number"] ?? "").trim().toUpperCase();

const log = (s = "") => console.log(s);
const head = (s: string) => { log(); log(`── ${s} ${"─".repeat(Math.max(0, 58 - s.length))}`); };
const day = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const org = await Organization.findOne({ name: ORG_NAME }).lean();
  if (!org) throw new Error(`No organisation named "${ORG_NAME}"`);

  log(`Organisation : ${org.name}`);
  log(`Source       : ${DIR}/${FILE}`);
  log(`Mode         : ${APPLY ? "APPLY — this writes" : "DRY RUN — nothing is written"}`);
  if (OVERWRITE) log(`             : --overwrite — dates already set will be replaced`);

  // ── Read ───────────────────────────────────────────────────────────────────
  head("The sheet");
  const rows = readSheet(DIR, FILE);
  if (!rows.length) throw new Error(`No rows read from ${DIR}/${FILE}`);

  const byCode = new Map<string, { date: Date; name: string }>();
  const disagreements: string[] = [];
  let unusable = 0;
  for (const r of rows) {
    const c = code(r);
    const d = parseDate(r["Joined On"]);
    if (!isEmployeeCode(c) || !d) { unusable++; continue; }
    const seen = byCode.get(c);
    // The export repeats people. Where two rows disagree the row is not silently
    // resolved — a joining date decides probation and tenure, and picking one at
    // random is how a wrong date becomes indistinguishable from a right one.
    if (seen && seen.date.getTime() !== d.getTime()) {
      disagreements.push(`${c} ${seen.name}: ${day(seen.date)} vs ${day(d)}`);
      continue;
    }
    if (!seen) byCode.set(c, { date: d, name: String(r["Employee Name"] ?? "").trim() });
  }
  log(`  ${rows.length} rows · ${byCode.size} distinct people with a usable date · ${unusable} rows without one`);

  if (disagreements.length) {
    head(`${disagreements.length} people the sheet gives two dates for — skipped`);
    for (const d of disagreements) log(`  ${d}`);
  }

  // ── Compare ────────────────────────────────────────────────────────────────
  head("Against the register");
  const employees = await Employee.find({ organization: org._id })
    .select("name employeeCode joiningDate status").sort({ employeeCode: 1 }).lean();

  interface Change { code: string; name: string; from: Date | null; to: Date; status: string }
  const fill: Change[] = [];
  const differs: Change[] = [];
  const agrees: Change[] = [];
  const noDate: typeof employees = [];

  for (const e of employees) {
    const hit = byCode.get(String(e.employeeCode).toUpperCase());
    if (!hit) { noDate.push(e); continue; }
    const current = (e.joiningDate as Date | null) ?? null;
    const row = { code: String(e.employeeCode), name: e.name, from: current, to: hit.date, status: String(e.status) };
    if (!current) fill.push(row);
    else if (new Date(current).getTime() === hit.date.getTime()) agrees.push(row);
    else differs.push(row);
  }

  log(`  ${employees.length} employees on file`);
  log(`  ${fill.length} have no joining date and the sheet has one   → ${APPLY ? "filling" : "would fill"}`);
  log(`  ${agrees.length} already match the sheet                     → left alone`);
  log(`  ${differs.length} already set to something else               → ${OVERWRITE ? "would be replaced" : "left alone"}`);
  log(`  ${noDate.length} the sheet has nothing for                    → left alone`);

  if (noDate.length) {
    head(`${noDate.length} with no date available`);
    for (const e of noDate) log(`  ${String(e.employeeCode).padEnd(8)} ${String(e.name).slice(0, 34).padEnd(36)} ${e.status}`);
  }

  if (differs.length) {
    head(`${differs.length} where the register and the sheet disagree`);
    log(`  code     name                                 on file      sheet`);
    for (const c of differs) log(`  ${c.code.padEnd(8)} ${c.name.slice(0, 34).padEnd(36)} ${day(c.from).padEnd(12)} ${day(c.to)}`);
    if (!OVERWRITE) log(`\n  Left as they are. Pass --overwrite to take the sheet's version.`);
  }

  const targets = OVERWRITE ? [...fill, ...differs] : fill;

  head(`${targets.length} to be filled in`);
  const years = new Map<string, number>();
  for (const c of targets) {
    const y = String(c.to.getFullYear());
    years.set(y, (years.get(y) ?? 0) + 1);
  }
  for (const [y, n] of [...years].sort()) log(`  ${y}  ${String(n).padStart(3)}`);
  log();
  log(`  first 12:`);
  for (const c of targets.slice(0, 12)) {
    log(`  ${c.code.padEnd(8)} ${c.name.slice(0, 34).padEnd(36)} ${day(c.from).padEnd(12)} → ${day(c.to)}`);
  }
  if (targets.length > 12) log(`  … and ${targets.length - 12} more`);

  // ── Write ──────────────────────────────────────────────────────────────────
  if (!APPLY) {
    head("Nothing was written");
    log(`  re-run with --apply to make these changes`);
    await mongoose.disconnect();
    return;
  }

  await MigrationRun.create({
    run: RUN, migration: MIGRATION, organization: org._id, organizationName: org.name,
    source: `${DIR}/${FILE}`,
  });
  let written = 0;
  for (const c of targets) {
    const doc = await Employee.findOne({ organization: org._id, employeeCode: c.code });
    if (!doc) continue;
    await MigrationJournal.updateOne(
      { run: RUN, collectionName: Employee.collection.name, documentId: doc._id },
      { $setOnInsert: { migration: MIGRATION, before: doc.toObject() } },
      { upsert: true }
    );
    doc.joiningDate = c.to;
    await doc.save();
    written++;
  }
  await MigrationRun.updateOne({ run: RUN }, { finishedAt: new Date(), updated: written });

  head("Applied");
  log(`  ${written} joining dates written · run ${RUN}`);
  log(`  revert with: bun src/seeds/revertMigration.ts --run=${RUN}`);
  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
