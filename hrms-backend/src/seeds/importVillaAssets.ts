import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Organization } from "../models/Organization.js";
import { Asset } from "../models/Asset.js";
import { MigrationJournal, MigrationRun } from "../models/MigrationJournal.js";
import { sheetGrid, t } from "./migrateAssets/read.js";

/**
 * Bring the Villa No. 25 asset list into the HRMS.
 *
 * Dry by default. Nothing is written unless `--apply` is passed, and the dry
 * run prints every record it would make.
 *
 * The workbook's "Asset Register" tab lists the villa room by room: an asset
 * type, a brand where known, a count and a remark. Nothing in it carries a tag
 * or a serial number, so each line becomes one record of counted stock with
 * a quantity — the same as the Delta Asset Sheet's bulk stock — rather than
 * one invented tag per chair. The summary tabs are not read: they add up to
 * 480 where the register's lines add up to 482, and the register is the one
 * that says where each thing is.
 *
 * Everything arrives available, in good condition (it is all in use), in the
 * office "Villa 25 Office", located by its room. The remarks name rooms and
 * cabins, not holders, so nothing is assigned to anybody.
 *
 * Each record is written to the migration journal before it is created, so a
 * run can be undone whole — even one that stopped part-way:
 *
 *   bun src/seeds/importVillaAssets.ts --file="~/Downloads/Villa No - 25 Asset List.xlsx"
 *   bun src/seeds/importVillaAssets.ts --file="…" --apply
 *   bun run migrate:greythr:revert -- --run=<run id>            # preview the undo
 *   bun run migrate:greythr:revert -- --run=<run id> --apply
 */

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const APPLY = args.includes("--apply");
const FILE = (arg("file") ?? `${process.env.HOME}/Downloads/Villa No - 25 Asset List.xlsx`).replace(/^~/, process.env.HOME ?? "~");
const ORG_NAME = arg("org") ?? "Delta International Management Development Training";
const BRANCH = "Villa 25 Office";
const TAB = "Asset Register";

const MIGRATION = "villa-25-assets";
const RUN = `villa25-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const log = (s = "") => console.log(s);

/**
 * Asset type → the kind stored on the asset, using the kinds already in use
 * where one fits. TVs, network gear and appliances had none, and get their own.
 */
const KIND: Record<string, string> = {};
for (const [kind, types] of Object.entries({
  furniture: [
    "Bean Bag", "Chair", "Cupboard", "Drawer Unit", "Drum Table", "Ironing Machine Stand", "Lecture Stand", "Locker",
    "Shelf", "Sofa", "Stool", "Table", "Wooden Stand", "Cushion", "Flower Vase", "Frame", "Lamp (Floor)", "Table Lamp",
  ],
  clock: ["Clock"],
  camera: ["CCTV Camera"],
  telephone: ["Landline Phone"],
  phone: ["Mobile Phone"],
  keyboard: ["Keyboard"],
  mouse: ["Mouse"],
  headphone: ["Headset"],
  speaker: ["Speaker"],
  other: ["Microphone"],
  tablet: ["Tablet", "Drawing Tab"],
  charger: ["Type-C Charger"],
  // "Monitor / desktop" was one kind in the Delta Asset Sheet; desktops stay with it.
  monitor: ["Monitor", "Spare Monitor", "Computer System (Screen)", "All-in-One PC", "Computer System"],
  tv: ["TV", "LED Screen"],
  network: ["Router", "Server Box"],
  appliance: ["Fridge", "Purifier"],
  printer: ["Printer", "Receipt Printer"],
  pos_machine: ["POS Machine", "Tabby/Tamara Machine"],
  accounts_equipment: ["Calculator", "Cash Counting Machine", "Petty Cash Box"],
})) for (const type of types) KIND[type.toLowerCase()] = kind;

/** One part of a made-up tag: letters and digits, upper case, twelve at most. */
const part = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "").toUpperCase().slice(0, 12);

interface Draft {
  assetTag: string; name: string; category: string; location: string; quantity: number; notes: string;
}

/**
 * The register, line by line. The room is written once and merged down the
 * lines below it, so it carries until the next one starts.
 */
function readRegister(): { drafts: Draft[]; problems: string[] } {
  const grid = sheetGrid(FILE, TAB);
  const problems: string[] = [];
  const header = grid.findIndex((r) => r[1]?.toLowerCase() === "area" && r[2]?.toLowerCase() === "asset type");
  if (header < 0) return { drafts: [], problems: [`No "${TAB}" tab with Area / Asset Type columns in ${FILE}`] };

  const drafts: Draft[] = [];
  const seen = new Map<string, number>();
  let room = "";
  for (const row of grid.slice(header + 1)) {
    const [, area, type, brand, qty, remarks] = row.map(t);
    if (area) room = area;
    if (!type) continue;
    const quantity = Math.round(Number(qty));
    if (!room) { problems.push(`"${type}" has no room above it — skipped`); continue; }
    if (!Number.isFinite(quantity) || quantity < 1) { problems.push(`${room} · ${type}: quantity "${qty}" isn't a count — skipped`); continue; }
    const category = KIND[type.toLowerCase()];
    if (!category) { problems.push(`${room} · ${type}: no kind for "${type}" — skipped`); continue; }

    // The same type twice in one room (two lines of cameras, two brands of
    // mouse) keeps both lines; the second takes a number.
    const base = `STOCK-V25-${part(room)}-${part(type)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    drafts.push({
      assetTag: n === 1 ? base : `${base}-${n}`,
      name: (brand ? `${type} · ${brand}` : type).slice(0, 120),
      category,
      location: room.slice(0, 80),
      quantity,
      notes: [remarks, "Counted, not individually tagged", "From the Villa No. 25 Asset List"].filter(Boolean).join(" · ").slice(0, 500),
    });
  }
  return { drafts, problems };
}

async function main() {
  log(`\n${APPLY ? "APPLYING" : "DRY RUN — nothing will be written"}`);
  log(`  file: ${FILE}`);
  const { drafts, problems } = readRegister();
  if (!drafts.length) {
    for (const p of problems) log(`  ! ${p}`);
    throw new Error("Nothing to import");
  }

  // The server owns the indexes; a dry run must only read.
  mongoose.set("autoIndex", false);
  await mongoose.connect(env.MONGODB_URI);
  const org = await Organization.findOne({ name: ORG_NAME }).select("_id name").lean<{ _id: mongoose.Types.ObjectId; name: string } | null>();
  if (!org) throw new Error(`No organisation named "${ORG_NAME}"`);
  log(`  into: ${org.name} · office "${BRANCH}"`);

  log(`\n── Records ${"─".repeat(50)}`);
  for (const d of drafts) {
    log(`  ${d.assetTag.padEnd(36)} ${String(d.quantity).padStart(3)} × ${d.name.padEnd(36)} ${d.category.padEnd(18)} ${d.location}`);
  }
  const byKind = new Map<string, { records: number; items: number }>();
  for (const d of drafts) {
    const e = byKind.get(d.category) ?? { records: 0, items: 0 };
    e.records++; e.items += d.quantity;
    byKind.set(d.category, e);
  }
  log(`\n── By kind ${"─".repeat(50)}`);
  for (const [k, e] of Array.from(byKind).sort((a, b) => b[1].records - a[1].records)) {
    log(`  ${k.padEnd(20)} ${String(e.records).padStart(4)} records  (${e.items} items)`);
  }
  const items = drafts.reduce((a, d) => a + d.quantity, 0);
  log(`  ${"total".padEnd(20)} ${String(drafts.length).padStart(4)} records covering ${items} items`);
  if (problems.length) { log(`\n── Skipped (${problems.length}) ${"─".repeat(40)}`); for (const p of problems) log(`  ! ${p}`); }

  // Never on top of a previous run: the tags would collide, and two copies of
  // the villa's furniture is not something anyone wants to untangle.
  const taken = await Asset.find({ organization: org._id, assetTag: { $in: drafts.map((d) => d.assetTag) } }).select("assetTag").lean();
  if (taken.length) {
    log(`\n  ! ${taken.length} of these tags already exist — it has been imported before. Revert that run first.`);
    log(`    ${taken.slice(0, 8).map((a) => a.assetTag).join(", ")}${taken.length > 8 ? " …" : ""}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (APPLY) {
    await MigrationRun.create({ run: RUN, migration: MIGRATION, organization: org._id, organizationName: org.name, source: FILE });
    let made = 0;
    for (const d of drafts) {
      // Journal first, then create: a run that stops part-way can still be undone whole.
      const _id = new mongoose.Types.ObjectId();
      await MigrationJournal.create({ run: RUN, migration: MIGRATION, collectionName: Asset.collection.name, documentId: _id, before: null });
      await Asset.create({
        _id, organization: org._id,
        assetTag: d.assetTag, name: d.name, category: d.category,
        condition: "good", status: "available", assignedTo: null,
        branch: BRANCH, location: d.location, quantity: d.quantity, notes: d.notes,
      });
      made++;
    }
    await MigrationRun.updateOne({ run: RUN }, { $set: { created: made, updated: 0, finishedAt: new Date(), stats: { items } } });
    log(`\n  created ${made} asset records (${items} items) · run id ${RUN}`);
    log(`  undo it with:  bun run migrate:greythr:revert -- --run=${RUN} --apply\n`);
  } else {
    log(`\nNothing was written. Re-run with --apply to import.\n`);
  }
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error("\nImport failed:", e instanceof Error ? e.message : e);
  await mongoose.disconnect();
  process.exit(1);
});
