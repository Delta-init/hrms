import * as fs from "node:fs";
import * as path from "node:path";
import mongoose from "mongoose";
import * as XLSX from "xlsx";
import { env } from "../../config/env.js";
import { Organization } from "../../models/Organization.js";
import { Employee } from "../../models/Employee.js";
import { Asset } from "../../models/Asset.js";
import { MigrationJournal, MigrationRun } from "../../models/MigrationJournal.js";

/**
 * Match the imported register's holder names to real employees.
 *
 * The asset migration deliberately assigned nothing: the Delta sheet names
 * holders in free text — "Azhar", "Anas", "Rahul (accounts)" — and guessing
 * would have written hundreds of wrong assignments that nobody could tell apart
 * from right ones. It kept each name in the asset's notes instead.
 *
 * This reads those notes back and does the matching properly, in tiers, and only
 * writes the tiers that cannot be wrong:
 *
 *   exact    the two names are the same once punctuation and case are gone
 *   full     every word of one name appears in the other, and one employee fits
 *            — "Azharuddeen K" is "Azharuddeen Kunnath" and nobody else
 *   partial  a single word matches one employee and no other — "Anas" is safe
 *            only while there is exactly one Anas
 *
 * Anything with two or more candidates, or none, is not guessed at. It goes into
 * the report for a human, which is the whole point: a wrong assignment is worse
 * than a blank one, because a blank one still says "unknown".
 *
 * Dry by default. `--apply` writes, journalled so the run can be reverted whole.
 *
 *   bun src/seeds/assignAssetHolders/index.ts
 *   bun src/seeds/assignAssetHolders/index.ts --apply
 *   bun src/seeds/assignAssetHolders/index.ts --apply --tiers=exact,full
 */

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=");
const APPLY = args.includes("--apply");
const ORG_NAME = arg("org") ?? "Delta International Management Development Training";
const TIERS = new Set((arg("tiers") ?? "exact,full,partial").split(",").map((s) => s.trim()));
const OUT = (arg("out") ?? `${process.env.HOME}/Downloads/Asset holders — status.xlsx`).replace(/^~/, process.env.HOME ?? "~");

const MIGRATION = "delta-asset-holders";
const RUN = `holders-${new Date().toISOString().replace(/[:.]/g, "-")}`;

const log = (s = "") => console.log(s);
const head = (s: string) => { log(); log(`── ${s} ${"─".repeat(Math.max(0, 58 - s.length))}`); };

/** A name reduced to what two spellings of the same person have in common. */
const nameKey = (v: unknown): string =>
  String(v ?? "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

/**
 * Words worth matching on.
 *
 * Initials and honorifics are dropped: "Azharuddeen K" and "Azharuddeen" are the
 * same person, and keeping the "k" would make them differ. Anything of one
 * letter is an initial by definition.
 */
const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "md"]);
const tokens = (v: string) => nameKey(v).split(" ").filter((w) => w.length > 1 && !TITLES.has(w));

type Tier = "exact" | "full" | "partial" | "ambiguous" | "none";
interface Candidate { _id: unknown; name: string; employeeCode: string; status: string }
interface Verdict { tier: Tier; employee?: Candidate; candidates: Candidate[] }

function classify(sheetName: string, staff: Candidate[]): Verdict {
  const key = nameKey(sheetName);
  const want = tokens(sheetName);
  if (!key || !want.length) return { tier: "none", candidates: [] };

  const exact = staff.filter((e) => nameKey(e.name) === key);
  if (exact.length === 1) return { tier: "exact", employee: exact[0], candidates: exact };
  if (exact.length > 1) return { tier: "ambiguous", candidates: exact };

  // Every word of the sheet's name present in the employee's, or the reverse.
  // Both directions matter: the sheet abbreviates as often as it elaborates.
  const contains = (a: string[], b: string[]) => a.every((w) => b.includes(w));
  const full = staff.filter((e) => {
    const has = tokens(e.name);
    return want.length > 1 && has.length > 0 && (contains(want, has) || contains(has, want));
  });
  if (full.length === 1) return { tier: "full", employee: full[0], candidates: full };
  if (full.length > 1) return { tier: "ambiguous", candidates: full };

  // One word, matching one person and no other.
  const partial = staff.filter((e) => tokens(e.name).some((w) => want.includes(w)));
  if (partial.length === 1) return { tier: "partial", employee: partial[0], candidates: partial };
  if (partial.length > 1) return { tier: "ambiguous", candidates: partial };

  return { tier: "none", candidates: [] };
}

const SHEET_HOLDER = /Sheet says held by:\s*(.+)/;

async function main() {
  await mongoose.connect(env.MONGODB_URI);
  const org = await Organization.findOne({ name: ORG_NAME }).lean();
  if (!org) throw new Error(`No organisation named "${ORG_NAME}"`);

  log(`Organisation : ${org.name}`);
  log(`Mode         : ${APPLY ? "APPLY — this writes" : "DRY RUN — nothing is written"}`);
  log(`Auto-assign  : ${[...TIERS].join(", ")}`);

  const staff: Candidate[] = (
    await Employee.find({ organization: org._id }).select("name employeeCode status").lean()
  ).map((e) => ({ _id: e._id, name: String(e.name ?? ""), employeeCode: String(e.employeeCode ?? ""), status: String(e.status ?? "") }));

  const assets = await Asset.find({ organization: org._id }).populate("assignedTo", "name employeeCode").lean();

  head("What the register says");
  const held = assets.filter((a) => SHEET_HOLDER.test(String(a.notes ?? "")));
  const already = assets.filter((a) => a.assignedTo);
  log(`  ${assets.length} assets · ${already.length} already assigned · ${held.length} naming a holder in the notes`);
  log(`  ${staff.length} employees on file (${staff.filter((s) => s.status === "terminated").length} terminated)`);

  // One verdict per distinct name, not per asset: the same person holds several.
  const byName = new Map<string, { name: string; assets: typeof held }>();
  for (const a of held) {
    const who = String(a.notes ?? "").match(SHEET_HOLDER)![1].trim();
    const k = nameKey(who);
    const e = byName.get(k) ?? { name: who, assets: [] };
    e.assets.push(a);
    byName.set(k, e);
  }
  const verdicts = [...byName.values()].map((v) => ({ ...v, ...classify(v.name, staff) }));

  head("How the names resolve");
  const counts = new Map<Tier, { names: number; assets: number }>();
  for (const v of verdicts) {
    const e = counts.get(v.tier) ?? { names: 0, assets: 0 };
    e.names++; e.assets += v.assets.length;
    counts.set(v.tier, e);
  }
  const ORDER: Tier[] = ["exact", "full", "partial", "ambiguous", "none"];
  const WHAT: Record<Tier, string> = {
    exact: "same name", full: "one name inside the other", partial: "single word, one candidate",
    ambiguous: "several people fit — needs you", none: "nobody on file — needs you",
  };
  for (const tier of ORDER) {
    const c = counts.get(tier);
    if (!c) continue;
    const auto = TIERS.has(tier) && tier !== "ambiguous" && tier !== "none";
    log(`  ${tier.padEnd(10)} ${String(c.names).padStart(3)} names · ${String(c.assets).padStart(3)} assets   ${auto ? "→ assign" : "→ report"}   ${WHAT[tier]}`);
  }

  const willAssign = verdicts.filter((v) => v.employee && TIERS.has(v.tier));
  const needsYou = verdicts.filter((v) => !v.employee || !TIERS.has(v.tier));
  const assetsToAssign = willAssign.reduce((n, v) => n + v.assets.length, 0);
  log();
  log(`  ${assetsToAssign} assets would be assigned · ${needsYou.reduce((n, v) => n + v.assets.length, 0)} left for you`);

  if (args.includes("--show")) {
    head("Every match, so the weak ones can be eyeballed");
    for (const v of willAssign.sort((a, b) => a.tier.localeCompare(b.tier))) {
      log(`  ${v.tier.padEnd(8)} "${v.name}"`.padEnd(46) + `→ ${v.employee!.name} (${v.employee!.employeeCode}${v.employee!.status === "terminated" ? ", LEFT" : ""})  ${v.assets.length} assets`);
    }
  }

  if (needsYou.length) {
    head("Names needing a decision");
    for (const v of needsYou.sort((a, b) => b.assets.length - a.assets.length).slice(0, 25)) {
      const cands = v.candidates.map((c) => `${c.name} (${c.employeeCode})`).join(" · ") || "no candidate";
      log(`  ${v.name.padEnd(28)} ${String(v.assets.length).padStart(3)} assets   ${cands}`);
    }
    if (needsYou.length > 25) log(`  … and ${needsYou.length - 25} more, all of them in the workbook`);
  }

  // ── Write ──────────────────────────────────────────────────────────────────
  let assigned = 0;
  if (APPLY) {
    await MigrationRun.create({ run: RUN, migration: MIGRATION, organization: org._id, organizationName: org.name, source: "holder names in asset notes" });
    for (const v of willAssign) {
      for (const a of v.assets) {
        if (a.assignedTo) continue;
        const doc = await Asset.findById(a._id);
        if (!doc) continue;
        await MigrationJournal.updateOne(
          { run: RUN, collectionName: Asset.collection.name, documentId: doc._id },
          { $setOnInsert: { migration: MIGRATION, before: doc.toObject() } },
          { upsert: true }
        );
        const now = new Date();
        doc.assignedTo = v.employee!._id as never;
        doc.assignedDate = now;
        doc.status = "assigned";
        doc.history.push({
          action: "issued", employee: v.employee!._id as never, date: now,
          condition: doc.condition, notes: `Matched from the imported register ("${v.name}", ${v.tier})`,
        } as never);
        await doc.save();
        assigned++;
      }
    }
    await MigrationRun.updateOne({ run: RUN }, { finishedAt: new Date(), updated: assigned, stats: Object.fromEntries(counts) });
    head("Applied");
    log(`  ${assigned} assets assigned · run ${RUN}`);
    log(`  revert with: bun src/seeds/revertMigration.ts --run=${RUN}`);
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  const fresh = await Asset.find({ organization: org._id }).populate("assignedTo", "name employeeCode designation").sort({ assetTag: 1 }).lean();
  const holderOf = (a: (typeof fresh)[number]) => String(a.notes ?? "").match(SHEET_HOLDER)?.[1]?.trim() ?? "";
  const emp = (a: (typeof fresh)[number]) => (a.assignedTo && typeof a.assignedTo === "object" ? (a.assignedTo as { name?: string; employeeCode?: string }) : null);

  const leavers = new Set(staff.filter((e) => e.status === "terminated").map((e) => e.employeeCode));

  const tally = <T>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };

  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: unknown[][]) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31));

  add("Summary", [
    ["Delta asset register — status", ""],
    ["Generated", new Date().toISOString().slice(0, 16).replace("T", " ")],
    ["Mode", APPLY ? "applied" : "dry run (nothing written)"],
    [],
    ["Assets on file", fresh.length],
    ["Assigned to an employee", fresh.filter((a) => a.assignedTo).length],
    ["Unassigned", fresh.filter((a) => !a.assignedTo).length],
    ["…of which name a holder we could not match", fresh.filter((a) => !a.assignedTo && holderOf(a)).length],
    ["…of which name nobody at all", fresh.filter((a) => !a.assignedTo && !holderOf(a)).length],
    ["Total items (quantities added up)", fresh.reduce((n, a) => n + (a.quantity ?? 1), 0)],
    ["Held by someone who has left", fresh.filter((a) => emp(a) && leavers.has(String(emp(a)!.employeeCode))).length],
    [],
    ["By status", ""],
    ...tally(fresh, (a) => String(a.status)),
    [],
    ["By category", ""],
    ...tally(fresh, (a) => String(a.category)),
    [],
    ["By branch", ""],
    ...tally(fresh, (a) => String(a.branch || "(none)")),
  ]);

  add("Needs your decision", [
    ["Name in sheet", "Assets", "Why", "Possible matches", "EMPLOYEE CODE (fill in)"],
    ...needsYou
      .sort((a, b) => b.assets.length - a.assets.length)
      .map((v) => [
        v.name, v.assets.length,
        v.tier === "ambiguous" ? "Several people fit" : "Nobody on file matches",
        v.candidates.map((c) => `${c.name} (${c.employeeCode})`).join(" · "),
        "",
      ]),
  ]);

  add("Matched", [
    ["Name in sheet", "Matched to", "Code", "Status", "Confidence", "Assets"],
    ...willAssign
      .sort((a, b) => b.assets.length - a.assets.length)
      .map((v) => [v.name, v.employee!.name, v.employee!.employeeCode, v.employee!.status, v.tier, v.assets.length]),
  ]);

  add("All assets", [
    ["Tag", "Name", "Category", "Status", "Qty", "Branch", "Location", "Serial", "Assigned to", "Code", "Sheet says held by", "Notes"],
    ...fresh.map((a) => [
      a.assetTag, a.name, a.category, a.status, a.quantity ?? 1, a.branch ?? "", a.location ?? "",
      a.serialNumber ?? "", emp(a)?.name ?? "", emp(a)?.employeeCode ?? "", holderOf(a), a.notes ?? "",
    ]),
  ]);

  add("Unassigned", [
    ["Tag", "Name", "Category", "Qty", "Branch", "Location", "Sheet says held by"],
    ...fresh.filter((a) => !a.assignedTo).map((a) => [
      a.assetTag, a.name, a.category, a.quantity ?? 1, a.branch ?? "", a.location ?? "", holderOf(a),
    ]),
  ]);

  /**
   * Assets sitting with people who have left.
   *
   * Worth its own sheet rather than a column: this is the only list here that
   * is a task. Everything else describes the register; this one says what has
   * to be collected back.
   */
  add("Held by leavers", [
    ["Employee", "Code", "Tag", "Asset", "Category", "Qty", "Branch"],
    ...fresh
      .filter((a) => emp(a) && leavers.has(String(emp(a)!.employeeCode)))
      .map((a) => [emp(a)!.name ?? "", emp(a)!.employeeCode ?? "", a.assetTag, a.name, a.category, a.quantity ?? 1, a.branch ?? ""]),
  ]);

  add("By employee", [
    ["Employee", "Code", "Assets", "What they hold"],
    ...[...fresh.filter((a) => emp(a)).reduce((m, a) => {
      const e = emp(a)!;
      const k = String(e.employeeCode || e.name);
      const cur = m.get(k) ?? { name: e.name ?? "", code: e.employeeCode ?? "", items: [] as string[] };
      cur.items.push(`${a.assetTag} ${a.name}`);
      m.set(k, cur);
      return m;
    }, new Map<string, { name: string; code: string; items: string[] }>()).values()]
      .sort((a, b) => b.items.length - a.items.length)
      .map((r) => [r.name, r.code, r.items.length, r.items.join(" · ")]),
  ]);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  XLSX.writeFile(wb, OUT);
  head("Report");
  log(`  ${OUT}`);

  await mongoose.disconnect();
}

main().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
