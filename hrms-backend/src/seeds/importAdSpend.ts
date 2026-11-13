/**
 * Bring the recruiter's old ad spend spreadsheet into the tracker, once.
 *
 * Reads the cleaned lines (a JSON list of { weekStart, role, amounts, note },
 * dates and text amounts already fixed and checked by HR) and files them as
 * weeks marked "imported". A week that already exists is left alone, so a
 * re-run cannot double anything and nothing logged by hand is overwritten.
 *
 * Optionally sets the organisation's monthly budget and the Monday the weekly
 * log is owed from, which is what switches the reminders on.
 *
 *     bun src/seeds/importAdSpend.ts --org <id> --file cleaned.json
 *     bun src/seeds/importAdSpend.ts --org <id> --file cleaned.json --budget 4000 --tracking-from 2026-11-02 --apply
 */
import { readFileSync } from "node:fs";
import mongoose, { Types } from "mongoose";
import { connectDB } from "../config/database.js";
import { Organization } from "../models/Organization.js";
import { AdSpendWeek } from "../models/AdSpendWeek.js";
import { AdSpendSettings } from "../models/AdSpendSettings.js";
import { DEFAULT_PLATFORMS } from "../services/adSpendService.js";
import { isMonday, monthOfWeek, round2, tidyLines, weekTotal } from "../utils/adSpend.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

interface Line { weekStart: string; role: string; amounts: { platform: string; amount: number }[]; note?: string }

async function main() {
  const apply = process.argv.includes("--apply");
  const orgId = arg("org");
  const file = arg("file");
  const budget = arg("budget");
  const trackingFrom = arg("tracking-from");
  if (!orgId || !file) throw new Error("--org and --file are required");
  if (trackingFrom && !isMonday(trackingFrom)) throw new Error("--tracking-from must be a Monday (YYYY-MM-DD)");

  await connectDB();
  const org = await Organization.findById(orgId).select("name settings.currency").lean();
  if (!org) throw new Error(`No organisation ${orgId}`);
  const organization = new Types.ObjectId(orgId);
  const currency = org.settings?.currency || "AED";
  console.log(`Mode: ${apply ? "APPLY" : "dry run"} · ${org.name} · ${currency}\n`);

  const settings = await AdSpendSettings.findOne({ organization }).lean();
  const platforms = settings?.platforms?.length ? settings.platforms : DEFAULT_PLATFORMS;
  const known = new Set(platforms.map((p) => p.key));

  const lines = JSON.parse(readFileSync(file, "utf8")) as Line[];
  const byWeek = new Map<string, Line[]>();
  for (const l of lines) {
    if (!isMonday(l.weekStart)) throw new Error(`${l.weekStart} (${l.role}) is not a Monday`);
    for (const a of l.amounts) if (!known.has(a.platform)) throw new Error(`Unknown platform ${a.platform} (${l.role})`);
    byWeek.set(l.weekStart, [...(byWeek.get(l.weekStart) ?? []), l]);
  }

  let total = 0, written = 0, skipped = 0;
  const months = new Map<string, number>();
  for (const [weekStart, raw] of [...byWeek.entries()].sort()) {
    const tidy = tidyLines(raw.map((l) => ({ ...l, requisition: null })));
    const sum = weekTotal(tidy);
    const exists = await AdSpendWeek.exists({ organization, weekStart });
    console.log(`  ${weekStart}  ${String(tidy.length).padStart(2)} role(s)  ${sum.toFixed(2).padStart(9)}${exists ? "  — already there, left alone" : ""}`);
    if (exists) { skipped += 1; continue; }
    total += sum;
    months.set(monthOfWeek(weekStart), round2((months.get(monthOfWeek(weekStart)) ?? 0) + sum));
    if (apply) {
      const at = new Date();
      await AdSpendWeek.create({
        organization, weekStart, currency, total: sum, nothingSpent: false, source: "import",
        note: "Imported from the recruitment ad spend spreadsheet",
        lines: tidy.map((l) => ({ requisition: null, role: l.role, amounts: l.amounts, note: l.note ?? "" })),
        loggedBy: null, loggedAt: at, history: [{ at, by: null, action: "imported", total: sum }],
      });
    }
    written += 1;
  }

  console.log(`\n${written} week(s) ${apply ? "imported" : "to import"}, ${skipped} skipped, ${round2(total).toFixed(2)} ${currency}`);
  for (const [m, v] of [...months.entries()].sort()) console.log(`  ${m}  ${v.toFixed(2)}`);

  if (budget !== undefined || trackingFrom) {
    const $set: Record<string, unknown> = {};
    if (budget !== undefined) $set.monthlyBudget = round2(Number(budget));
    if (trackingFrom) $set.trackingFrom = trackingFrom;
    console.log(`\nSettings: ${JSON.stringify($set)}`);
    if (apply) {
      await AdSpendSettings.updateOne(
        { organization },
        { $set, $setOnInsert: { organization, currency, platforms } },
        { upsert: true }
      );
    }
  }

  if (!apply) console.log("\nDry run — re-run with --apply to write.");
  await mongoose.disconnect();
}
main().catch(async (e) => { console.error(e instanceof Error ? e.message : e); await mongoose.disconnect(); process.exit(1); });
