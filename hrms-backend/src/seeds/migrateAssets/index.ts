import mongoose from "mongoose";
import { env } from "../../config/env.js";
import { Organization } from "../../models/Organization.js";
import { Employee } from "../../models/Employee.js";
import { Asset } from "../../models/Asset.js";
import { MigrationJournal, MigrationRun } from "../../models/MigrationJournal.js";
import { t, code, nameKey, sheetRows, sheetGrid, parseDate, parseMoney, fileIn, readFixtureLabel, fixtureCategory } from "./read.js";
import { readSheet } from "../migrateGreytHR/read.js";

/**
 * Bring the Delta Asset Sheet into the HRMS.
 *
 * Dry by default. Nothing is written unless `--apply` is passed, and the dry run
 * prints what would change — the register is going live off the back of this, so
 * "run it and see" is not available.
 *
 * The workbook holds two kinds of thing and this keeps them apart. Most rows are
 * individually tagged items, one record each. The rest are counts of untagged
 * stock — thirty-five chairs with no labels on them — which become one record
 * carrying a quantity, because inventing thirty-five asset tags would produce
 * records nobody could match to a real chair.
 *
 * Holders are not guessed. The sheet names them in free text and two thirds match
 * nobody in the system, so assignment happens only from a filled-in matching
 * workbook passed with --match. Without it every asset arrives unassigned, with
 * the name it came with kept in the notes.
 *
 *   bun src/seeds/migrateAssets/index.ts --dir=~/Downloads
 *   bun src/seeds/migrateAssets/index.ts --dir=~/Downloads --match="Asset holders to match.xlsx"
 *   bun src/seeds/migrateAssets/index.ts --dir=~/Downloads --apply
 */

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const APPLY = args.includes("--apply");
const DIR = (arg("dir") ?? `${process.env.HOME}/Downloads`).replace(/^~/, process.env.HOME ?? "~");
const MASTER = fileIn(DIR, arg("file") ?? "Delta Asset Sheet.xlsx");
const ALLOC = fileIn(DIR, arg("alloc") ?? "AssetAllocation.xlsx");
const MATCH = arg("match") ? fileIn(DIR, arg("match")!) : null;
const ORG_NAME = arg("org") ?? "Delta International Management Development Training";

const MIGRATION = "delta-assets";
const RUN = `assets-${new Date().toISOString().replace(/[:.]/g, "-")}`;

const log = (s = "") => console.log(s);
const head = (s: string) => { log(); log(`── ${s} ${"─".repeat(Math.max(0, 58 - s.length))}`); };
const notes: string[] = [];
const note = (s: string) => notes.push(s);

/** Sheet category → the slug stored on the asset. Anything unlisted passes through. */
const CATEGORY: Record<string, string> = {
  "laptop": "laptop", "monitor / desktop": "monitor", "mobile phone": "phone",
  "mouse": "mouse", "keyboard": "keyboard", "headphone": "headphone",
  "room / fixture": "furniture", "accounts equipment": "accounts_equipment",
  "telephone": "telephone", "tablet": "tablet", "pos machine": "pos_machine",
  "printer": "printer", "charger": "charger", "mini pc": "mini_pc",
  "sim card": "sim_card", "camera": "camera", "cameras": "camera",
  "clock": "clock", "clocks": "clock", "speaker": "speaker", "speakers": "speaker",
  "first aid box": "first_aid", "spinning wheel": "other",
  // Bulk_Stock writes these as "Room assets (Meeting room 1)"; the bracket is
  // stripped before lookup, so the bare label has to resolve too.
  "room assets": "furniture",
  "chair": "furniture", "manager chairs": "furniture", "chairs": "furniture",
  "tables": "furniture", "wardrobe": "furniture", "reception table": "furniture",
  "waste bins": "furniture", "white board": "furniture", "uniform": "uniform",
};
const slug = (c: string) =>
  CATEGORY[c.toLowerCase().trim()] ?? (c.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "other");

/** Sheet status → the four the model allows. */
const STATUS: Record<string, string> = { assigned: "assigned", spare: "available", unassigned: "available", faulty: "maintenance" };

interface Draft {
  assetTag: string; name: string; category: string; serialNumber?: string;
  purchaseCost?: number | null; status: string; branch?: string; location?: string;
  quantity: number; notes: string[]; holder: string; source: string;
}
const drafts = new Map<string, Draft>();
const collisions: string[] = [];

function push(d: Draft) {
  const key = d.assetTag.toUpperCase();
  const existing = drafts.get(key);
  if (!existing) { drafts.set(key, d); return; }
  // Two rows for one tag. The fuller wins, the same rule the visa sheet uses,
  // and the collision is reported rather than silently resolved.
  collisions.push(`${d.assetTag} — "${existing.name}" (${existing.source}) vs "${d.name}" (${d.source})`);
  const score = (x: Draft) => [x.serialNumber, x.holder, x.branch, x.location, x.notes.join("")].filter(Boolean).length;
  if (score(d) > score(existing)) drafts.set(key, d);
}

/** The sheet writes shirts as three yes/no columns, in this order. */
const SHIRT_COLOURS = ["Blue", "Yellow", "Rose"];

/** A tag for something that has none of its own. Distinct per branch, kind and variant. */
const stockTag = (branch: string, kind: string, variant: string) =>
  ["STOCK", branch, kind, variant]
    .map((p) => p.replace(/[^A-Za-z0-9]+/g, "").toUpperCase().slice(0, 12))
    .filter(Boolean).join("-").slice(0, 40);

/**
 * The GreytHR export opens with a one-cell title banner, so its header is not
 * row one. The migration reader already knows that quirk — reuse it rather
 * than repeat the trick here.
 */
const allocRows = () => readSheet(DIR, arg("alloc") ?? "AssetAllocation.xlsx");

const clean = (parts: (string | undefined)[]) => parts.map((p) => t(p)).filter(Boolean).join(" · ").slice(0, 500);

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  log(`\n${APPLY ? "APPLYING" : "DRY RUN — nothing will be written"}`);
  log(`  master : ${MASTER}`);
  log(`  alloc  : ${ALLOC}`);
  log(`  match  : ${MATCH ?? "(none — every asset arrives unassigned)"}`);
  log(`  target : ${ORG_NAME}`);

  const org = await Organization.findOne({ name: ORG_NAME });
  if (!org) throw new Error(`No organisation named "${ORG_NAME}"`);

  // Loaded before the first sheet rather than at the holder step, because the
  // Assets tab needs it to tell "Monitor- Megha" from "Chair- 10".
  const employees = await Employee.find({ organization: org._id, status: { $ne: "terminated" } })
    .select("name employeeCode").lean();
  const firstNames = new Set(employees.flatMap((e) => nameKey(e.name).split(" ")).filter((w) => w.length > 2));
  const isEmployeeWord = (w: string) => firstNames.has(nameKey(w));

  // ── 1. Tagged assets ──────────────────────────────────────────────────────
  head("Tagged assets");
  for (const r of sheetRows(MASTER, "Assets")) {
    const c = code(r["Code"]);
    if (!/^D[A-Z]+\d+$/.test(c)) continue;
    const cat = t(r["Category"]);
    // The charger and the cameras both claimed DC01. The charger moves aside.
    const tag = c === "DC01" && /charger/i.test(cat) ? "DCR01" : c;
    /**
     * A room fixture belongs to a room, not a person, so the sheet reuses the
     * "Assigned To" column on those rows to say what the thing is — "Curved
     * Monitor", "Chair- 10", "Monitor- Megha". Reading it as a holder produced
     * fifty-four assets all called "Room / fixture" with a phantom owner.
     */
    const isFixture = /^room \/ fixture$/i.test(cat);
    const fixture = isFixture ? readFixtureLabel(t(r["Assigned To"]), isEmployeeWord) : null;
    push({
      assetTag: tag,
      name: fixture?.name
        ? clean([fixture.name, t(r["Brand / Model"])])
        : clean([t(r["Brand / Model"]), cat]) || cat || "Asset",
      category: fixture?.name ? fixtureCategory(fixture.name) : slug(cat),
      serialNumber: t(r["Serial Number"]) || undefined,
      purchaseCost: parseMoney(r["Asset Value"]),
      status: STATUS[t(r["Status"]).toLowerCase()] ?? "available",
      branch: t(r["Branch"]), location: t(r["Location"]),
      quantity: fixture?.quantity ?? 1,
      notes: [
        tag !== c ? `Re-tagged from ${c}; the cameras keep DC01–DC06` : "",
        !isFixture && t(r["Raw Allocation"]) && t(r["Raw Allocation"]) !== t(r["Assigned To"]) ? `Allocation: ${t(r["Raw Allocation"])}` : "",
        !isFixture && t(r["Actually Used By"]) && t(r["Actually Used By"]) !== t(r["Assigned To"]) ? `Actually used by: ${t(r["Actually Used By"])}` : "",
        t(r["Remarks"]),
      ].filter(Boolean),
      holder: fixture ? fixture.holder : t(r["Assigned To"]),
      source: "Assets",
    });
  }
  log(`  ${drafts.size} from the Assets tab`);

  // ── 2. SIM cards ──────────────────────────────────────────────────────────
  const beforeSims = drafts.size;
  for (const r of sheetRows(MASTER, "SIM_Cards")) {
    const c = code(r["SIM Code"]);
    if (!c) continue;
    push({
      assetTag: c,
      name: clean([t(r["Number"]), t(r["Carrier"]), t(r["Type"])]) || "SIM card",
      category: "sim_card",
      serialNumber: t(r["Number"]) || undefined,
      status: t(r["Assigned To"]) ? "assigned" : "available",
      quantity: 1,
      notes: [
        t(r["Plan (AED)"]) ? `Plan: ${t(r["Plan (AED)"])} AED` : "",
        t(r["Registered To"]) && t(r["Registered To"]) !== t(r["Assigned To"]) ? `Registered to: ${t(r["Registered To"])}` : "",
        t(r["Actually Used By"]) && t(r["Actually Used By"]) !== t(r["Assigned To"]) ? `Actually used by: ${t(r["Actually Used By"])}` : "",
        t(r["Remarks"]),
      ].filter(Boolean),
      holder: t(r["Assigned To"]),
      source: "SIM_Cards",
    });
  }
  log(`  ${drafts.size - beforeSims} SIM cards`);

  // ── 3. Sheet16 — tagged items and loose counts, mixed together ────────────
  const beforeS16 = drafts.size;
  let s16stock = 0, s16items = 0;
  let group = "";
  for (const row of sheetGrid(MASTER, "Sheet16")) {
    if (row[0]) group = row[0];
    const cell = t(row[2]), desc = t(row[3]), brand = t(row[4]);
    if (!cell) continue;
    if (/^\d+$/.test(cell)) {
      // A count where the code should be — untagged stock.
      s16stock++;
      push({
        assetTag: stockTag("410", group, desc || String(s16stock)),
        name: clean([group, desc]) || group,
        category: slug(group), status: "available", quantity: Number(cell),
        branch: "410 Office", location: "General",
        notes: ["Counted, not individually tagged", desc].filter(Boolean),
        holder: "", source: "Sheet16 stock",
      });
    } else {
      s16items++;
      push({
        assetTag: code(cell),
        name: clean([desc, group]) || group,
        category: slug(group), status: "available", quantity: 1,
        branch: "410 Office", location: "General",
        notes: [brand].filter(Boolean), holder: "", source: "Sheet16",
      });
    }
  }
  log(`  ${s16items} tagged items and ${s16stock} stock lines from Sheet16 (${drafts.size - beforeS16} new)`);

  // ── 4. Bulk stock, only where nothing tagged already covers it ────────────
  /**
   * Which branch already has tagged items of a given kind, compared on the
   * sheet's own labels rather than the slugs. Chairs and room fixtures both
   * store as furniture, and comparing slugs would treat thirty-five chairs as
   * already covered by a meeting room's contents.
   */
  const covered = new Set<string>();
  for (const r of sheetRows(MASTER, "Assets")) {
    const c = code(r["Code"]);
    if (/^D[A-Z]+\d+$/.test(c) && t(r["Branch"])) covered.add(`${t(r["Branch"])}|${t(r["Category"]).toLowerCase()}`);
  }
  let bulkIn = 0, bulkSkipped = 0, bulkItems = 0;
  for (const r of sheetRows(MASTER, "Bulk_Stock")) {
    const item = t(r["Item"]), branch = t(r["Branch"]), qty = Number(t(r["Quantity"])) || 0;
    if (!item || !qty) continue;
    const bare = item.replace(/\s*\(.*\)$/, "").trim();
    // "Room assets (Meeting room 1)" is the summary of rows the Assets tab
    // files under "Room / fixture"; every other label matches itself.
    const label = /^room assets$/i.test(bare) ? "room / fixture" : bare.toLowerCase();
    const cat = slug(bare);
    // The six "Room assets" lines and the whole 710 block are summaries of rows
    // already imported individually; counting them again would inflate the
    // register by a third.
    if (covered.has(`${branch}|${label}`)) { bulkSkipped++; continue; }
    bulkIn++; bulkItems += qty;
    push({
      // The six "Room assets" lines differ only by the room in the bracket, so
      // the tag has to carry it or they all collapse onto one another.
      assetTag: stockTag(branch, item, /\((.+)\)/.exec(item)?.[1] ?? ""),
      name: `${item} (${qty})`, category: cat, status: "available", quantity: qty,
      branch, location: "General",
      notes: ["Counted, not individually tagged"], holder: "", source: "Bulk_Stock",
    });
  }
  log(`  ${bulkIn} bulk lines covering ${bulkItems} items · ${bulkSkipped} skipped as already tagged`);

  // ── 5. Uniforms ───────────────────────────────────────────────────────────
  let uniforms = 0;
  for (const r of sheetRows(MASTER, "Uniforms")) {
    const who = t(r["Name"]); if (!who) continue;
    const colours = ["Colour 1", "Colour 2", "Colour 3"].filter((k) => /^yes$/i.test(t(r[k])));
    const issued = parseDate(r["Date"]);
    uniforms++;
    push({
      assetTag: `UNIFORM-${who.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 24)}`,
      name: `${t(r["Set"]) || "Uniform"} set — ${colours.length} shirt${colours.length === 1 ? "" : "s"}`,
      category: "uniform", status: "assigned", quantity: colours.length || 1,
      notes: [
        colours.length ? `Colours: ${SHIRT_COLOURS.filter((_, i) => /^yes$/i.test(t(r[`Colour ${i + 1}`]))).join(", ")}` : "",
        /done/i.test(t(r["Belt"])) ? "Belt issued" : "",
        issued ? `Issued ${issued.toISOString().slice(0, 10)}` : "Issue date missing from the sheet",
        t(r["Designation"]),
      ].filter(Boolean),
      holder: who, source: "Uniforms",
    });
  }
  log(`  ${uniforms} uniform sets`);

  // ── 6. The SIMs only GreytHR knows about ──────────────────────────────────
  let greytSims = 0;
  for (const r of allocRows()) {
    for (const raw of t(r["Asset Serial Number"]).split(",")) {
      const c = code(raw);
      if (!c || drafts.has(c)) continue;
      greytSims++;
      push({
        assetTag: c, name: "SIM card", category: "sim_card",
        status: t(r["Status"]).toLowerCase() === "returned" ? "available" : "assigned",
        quantity: 1,
        notes: ["Known only to the GreytHR export", parseDate(r["Issue Date"]) ? `Issued ${parseDate(r["Issue Date"])!.toISOString().slice(0, 10)}` : ""].filter(Boolean),
        holder: t(r["Employee Name"]), source: "AssetAllocation",
      });
    }
  }
  log(`  ${greytSims} SIMs the Delta sheet has never heard of`);

  // ── 7. Holders ────────────────────────────────────────────────────────────
  head("Holders");
  const byCode = new Map(employees.map((e) => [String(e.employeeCode).toUpperCase(), e]));
  const resolved = new Map<string, { _id: unknown; name: string }>();

  if (MATCH) {
    for (const r of sheetRows(MATCH, "Holders")) {
      const who = t(r["Name in sheet"]), ec = t(r["EMPLOYEE CODE"]).toUpperCase();
      if (!who || !ec || ec === "UNASSIGNED") continue;
      const emp = byCode.get(ec);
      if (emp) resolved.set(nameKey(who), emp as never);
    }
    log(`  ${resolved.size} names resolved from the matching workbook`);
  } else {
    log(`  no matching workbook supplied — nothing is assigned`);
    note("every asset arrives unassigned; the holder's name from the sheet is kept in the notes");
  }

  const holders = new Set([...drafts.values()].map((d) => d.holder).filter(Boolean));
  const unresolved = [...holders].filter((h) => !resolved.has(nameKey(h)));
  log(`  ${holders.size} distinct holder names in the workbook · ${unresolved.length} unresolved`);

  // ── Write ─────────────────────────────────────────────────────────────────
  head("What this would create");
  const byCategory = new Map<string, { records: number; items: number }>();
  for (const d of drafts.values()) {
    const e = byCategory.get(d.category) ?? { records: 0, items: 0 };
    e.records++; e.items += d.quantity;
    byCategory.set(d.category, e);
  }
  for (const [c, e] of [...byCategory].sort((a, b) => b[1].records - a[1].records)) {
    log(`  ${c.padEnd(20)} ${String(e.records).padStart(4)} records${e.items !== e.records ? `  (${e.items} items)` : ""}`);
  }
  const totalItems = [...drafts.values()].reduce((a, d) => a + d.quantity, 0);
  log(`  ${"".padEnd(20)} ${"────".padStart(4)}`);
  log(`  ${"total".padEnd(20)} ${String(drafts.size).padStart(4)} records covering ${totalItems} items`);

  const existing = await Asset.countDocuments({ organization: org._id });
  if (existing) note(`${existing} assets already exist in this organisation — re-running would collide on the tag`);

  if (APPLY) {
    await MigrationRun.create({ run: RUN, migration: MIGRATION, organization: org._id, organizationName: org.name, source: MASTER });
    let made = 0;
    for (const d of drafts.values()) {
      const holder = resolved.get(nameKey(d.holder));
      const doc = await Asset.create({
        organization: org._id,
        assetTag: d.assetTag, name: d.name.slice(0, 120), category: d.category,
        serialNumber: d.serialNumber, purchaseCost: d.purchaseCost ?? undefined,
        status: holder ? "assigned" : d.status === "assigned" ? "available" : d.status,
        assignedTo: holder?._id ?? null,
        branch: d.branch ?? "", location: d.location ?? "", quantity: d.quantity,
        notes: clean([...d.notes, d.holder && !holder ? `Sheet says held by: ${d.holder}` : ""]),
      });
      await MigrationJournal.updateOne(
        { run: RUN, collectionName: Asset.collection.name, documentId: doc._id },
        { $setOnInsert: { migration: MIGRATION, before: null } },
        { upsert: true }
      );
      made++;
    }
    await MigrationRun.updateOne({ run: RUN }, { $set: { created: made, updated: 0, finishedAt: new Date() } });
    log(`\n  created ${made} assets · run id ${RUN}`);
  }

  if (collisions.length) {
    head("Tag collisions");
    for (const c of collisions.slice(0, 12)) log(`  ! ${c}`);
    if (collisions.length > 12) log(`  … and ${collisions.length - 12} more`);
  }
  if (unresolved.length) {
    head("Holder names with nobody attached");
    log(`  ${unresolved.length} names. Their assets arrive unassigned with the name kept in the notes.`);
    log(`  ${unresolved.slice(0, 10).join(", ")}${unresolved.length > 10 ? " …" : ""}`);
  }
  if (notes.length) { head(`Notes (${notes.length})`); for (const n of notes) log(`  · ${n}`); }
  log(APPLY ? "" : `\nNothing was written. Re-run with --apply to commit.\n`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error("\nMigration failed:", e instanceof Error ? e.message : e);
  await mongoose.disconnect();
  process.exit(1);
});
