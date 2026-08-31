import mongoose from "mongoose";
import { env } from "../../config/env.js";
import { Organization } from "../../models/Organization.js";
import { Employee } from "../../models/Employee.js";
import { Asset } from "../../models/Asset.js";
import { MigrationJournal, MigrationRun } from "../../models/MigrationJournal.js";
import { t, code, nameKey, sheetRows, fileIn, readFixtureLabel, fixtureCategory } from "../migrateAssets/read.js";

/**
 * Give the room fixtures their real names back.
 *
 * The first import read the Assets tab's "Assigned To" column as a person on
 * every row. On the fifty-four "Room / fixture" rows that column holds what the
 * thing *is* — a fixture belongs to a room, not to anybody — so those assets
 * landed named "Room / fixture", their actual identity stranded in the notes as
 * a holder called "Couch - 1" that no employee would ever match.
 *
 * This reads the sheet again and rewrites just those records: the real name, a
 * count where the label carried one ("Chair- 10" is ten chairs), a category read
 * from the name, and the phantom holder line removed. Two of them genuinely do
 * name a person — "Monitor- Megha" — and those keep the holder.
 *
 * Dry by default; `--apply` writes, journalled so it can be reverted whole.
 *
 *   bun src/seeds/repairRoomFixtures/index.ts
 *   bun src/seeds/repairRoomFixtures/index.ts --apply
 */

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const APPLY = args.includes("--apply");
const DIR = (arg("dir") ?? `${process.env.HOME}/Downloads`).replace(/^~/, process.env.HOME ?? "~");
const MASTER = fileIn(DIR, arg("file") ?? "Delta Asset Sheet.xlsx");
const ORG_NAME = arg("org") ?? "Delta International Management Development Training";

const MIGRATION = "delta-asset-fixtures";
const RUN = `fixtures-${new Date().toISOString().replace(/[:.]/g, "-")}`;

const log = (s = "") => console.log(s);
const head = (s: string) => { log(); log(`── ${s} ${"─".repeat(Math.max(0, 58 - s.length))}`); };
const clean = (parts: (string | undefined)[]) => parts.map((p) => t(p)).filter(Boolean).join(" · ").slice(0, 500);

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const org = await Organization.findOne({ name: ORG_NAME }).lean();
  if (!org) throw new Error(`No organisation named "${ORG_NAME}"`);

  log(`Organisation : ${org.name}`);
  log(`Sheet        : ${MASTER}`);
  log(`Mode         : ${APPLY ? "APPLY — this writes" : "DRY RUN — nothing is written"}`);

  const employees = await Employee.find({ organization: org._id, status: { $ne: "terminated" } })
    .select("name employeeCode").lean();
  const firstNames = new Set(employees.flatMap((e) => nameKey(e.name).split(" ")).filter((w) => w.length > 2));
  const isEmployeeWord = (w: string) => firstNames.has(nameKey(w));

  interface Change { tag: string; from: string; to: string; qty: number; category: string; holder: string }
  const changes: Change[] = [];
  let missing = 0, unchanged = 0;

  /**
   * Two rooms, one numbering scheme.
   *
   * Meeting room 1 and Meeting room 2 both label their contents DMR101 upward,
   * so four tags describe two different objects each. Writing both in sequence
   * would silently keep whichever came last and call it correct. They are set
   * aside for a decision instead — the register cannot hold two things under
   * one tag, and picking one is not ours to do.
   */
  const rowsByTag = new Map<string, Record<string, unknown>[]>();
  for (const r of sheetRows(MASTER, "Assets")) {
    const tag = code(r["Code"]);
    if (!/^D[A-Z]+\d+$/.test(tag)) continue;
    if (!/^room \/ fixture$/i.test(t(r["Category"]))) continue;
    rowsByTag.set(tag, [...(rowsByTag.get(tag) ?? []), r]);
  }
  const conflicts = [...rowsByTag].filter(([, rows]) => rows.length > 1);

  for (const [tag, rows] of rowsByTag) {
    if (rows.length > 1) continue;
    const r = rows[0];
    const label = readFixtureLabel(t(r["Assigned To"]), isEmployeeWord);
    if (!label.name) { unchanged++; continue; }

    const asset = await Asset.findOne({ organization: org._id, assetTag: tag });
    if (!asset) { missing++; continue; }

    const name = clean([label.name, t(r["Brand / Model"])]).slice(0, 120);
    const category = fixtureCategory(label.name);
    // Notes are one line joined with " · ", not one per line — the phantom
    // holder has to be found in the middle of it, not just at the start.
    const phantom = new RegExp(`Sheet says held by:\\s*${label.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
    const stale = phantom.test(String(asset.notes ?? ""));
    if (asset.name === name && asset.category === category && (asset.quantity ?? 1) === label.quantity && !stale) {
      unchanged++; continue;
    }
    changes.push({ tag, from: asset.name, to: name, qty: label.quantity, category, holder: label.holder });

    if (APPLY) {
      await MigrationJournal.updateOne(
        { run: RUN, collectionName: Asset.collection.name, documentId: asset._id },
        { $setOnInsert: { migration: MIGRATION, before: asset.toObject() } },
        { upsert: true }
      );
      asset.name = name;
      asset.category = category;
      asset.quantity = label.quantity;
      // The phantom holder goes; a real one stays for the matcher to find.
      const notes = String(asset.notes ?? "")
        .split(/\s·\s|\n/)
        .map((l) => l.trim())
        .filter((l) => l && !/^Sheet says held by:/i.test(l));
      if (label.holder) notes.push(`Sheet says held by: ${label.holder}`);
      asset.notes = notes.join(" · ").slice(0, 500);
      await asset.save();
    }
  }

  head(`${changes.length} fixtures renamed`);
  log(`  tag      quantity  category      name`);
  for (const c of changes) {
    log(`  ${c.tag.padEnd(8)} ${String(c.qty).padStart(6)}   ${c.category.padEnd(12)}  ${c.to}${c.holder ? `   → held by ${c.holder}` : ""}`);
  }
  const items = changes.reduce((n, c) => n + c.qty, 0);
  log();
  log(`  ${changes.length} records covering ${items} items · ${unchanged} already correct · ${missing} not found in the register`);

  if (conflicts.length) {
    head(`${conflicts.length} tags the sheet uses twice — left alone`);
    for (const [tag, rows] of conflicts) {
      log(`  ${tag}`);
      for (const r of rows) {
        const l = readFixtureLabel(t(r["Assigned To"]), isEmployeeWord);
        log(`      "${l.name}"${l.quantity > 1 ? ` ×${l.quantity}` : ""}  ${t(r["Brand / Model"]) || "—"}  in ${t(r["Location"]) || "?"}`);
      }
    }
    log();
    log(`  Two rooms number their contents the same way. Give each a distinct code`);
    log(`  in the sheet and re-run, or tell me which one keeps the tag.`);
  }

  if (APPLY) {
    await MigrationRun.create({
      run: RUN, migration: MIGRATION, organization: org._id, organizationName: org.name,
      source: MASTER, finishedAt: new Date(), updated: changes.length,
    });
    head("Applied");
    log(`  run ${RUN}`);
    log(`  revert with: bun src/seeds/revertMigration.ts --run=${RUN}`);
  } else {
    head("Nothing was written");
    log(`  re-run with --apply to make these changes`);
  }

  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
