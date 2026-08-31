import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";

/** Trimmed string, whatever the cell actually held. */
export const t = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

/** An asset code with the spacing normalised away: "DS 01" and "DS01" are one thing. */
export const code = (v: unknown): string => t(v).toUpperCase().replace(/\s+/g, "");

/** A name reduced to what two spellings of the same person have in common. */
export const nameKey = (v: unknown): string =>
  t(v).toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

export function sheetRows(file: string, tab: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return [];
  const wb = XLSX.readFile(file, { cellDates: false, raw: false });
  if (!wb.Sheets[tab]) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[tab], { defval: "" });
}

export function sheetGrid(file: string, tab: string): string[][] {
  if (!fs.existsSync(file)) return [];
  const wb = XLSX.readFile(file, { cellDates: false, raw: false });
  if (!wb.Sheets[tab]) return [];
  return XLSX.utils
    .sheet_to_json<unknown[]>(wb.Sheets[tab], { header: 1, blankrows: false, defval: "" })
    .map((r) => r.map(t))
    .filter((r) => r.some(Boolean));
}

const MONTHS: Record<string, number> = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };

/**
 * The three date shapes this workbook uses.
 *
 * "01 JUN 2024" from GreytHR, "28/10/2025" typed by hand, and bare numbers like
 * 45966 — Excel serials that survived the export as numbers. All three appear in
 * the uniform tab alone.
 */
export function parseDate(v: unknown): Date | null {
  const s = t(v);
  if (!s) return null;

  const greyt = /^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -](\d{4})/.exec(s);
  if (greyt) {
    const m = MONTHS[greyt[2].toUpperCase()];
    if (m !== undefined) return new Date(Date.UTC(+greyt[3], m, +greyt[1]));
  }

  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dmy) return new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]));

  // Excel counts days from 1899-12-30. Bounded so an asset code or a quantity
  // that happens to be numeric is never read as a date.
  if (/^\d{5}$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 60000) return new Date(Date.UTC(1899, 11, 30) as never as number + n * 86_400_000);
  }
  return null;
}

/** "800 aed" → 800. Anything without a number in it → null. */
export function parseMoney(v: unknown): number | null {
  const n = Number(t(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const fileIn = (dir: string, name: string) => path.join(dir, name);

/**
 * What a "Room / fixture" row is actually describing.
 *
 * These rows do not belong to a person, they belong to a room — so the sheet
 * reuses the "Assigned To" column to say what the thing *is*: "Curved Monitor",
 * "Chair- 10", "Monitor- Megha". Read literally that produces fifty-four assets
 * all named "Room / fixture" with a phantom holder called "Couch - 1", which is
 * how the first import left them.
 *
 * A trailing number is a count, not part of the name — "Chair- 10" is ten
 * chairs. A trailing word that names a real employee is a genuine holder, which
 * is why the caller passes in the staff list rather than this guessing.
 */
export function readFixtureLabel(label: string, isEmployee: (name: string) => boolean) {
  const raw = t(label);
  if (!raw) return { name: "", quantity: 1, holder: "" };

  // "Hanging Lights- 3 Set", "Chair- 10", "Vending Machine-1"
  const counted = /^(.*?)[\s-]+(\d+)(\s*set)?$/i.exec(raw);
  if (counted && Number(counted[2]) > 0) {
    return { name: counted[1].trim(), quantity: Number(counted[2]), holder: "" };
  }

  // "Monitor- Megha" — an item and the person it sits with.
  const named = /^(.*?)[\s-]+([A-Za-z]+)$/.exec(raw);
  if (named && isEmployee(named[2])) {
    return { name: named[1].trim(), quantity: 1, holder: named[2].trim() };
  }

  return { name: raw, quantity: 1, holder: "" };
}

/** A fixture's kind, read from its own name; anything unrecognised is furniture. */
const FIXTURE_WORDS: [RegExp, string][] = [
  [/\bmonitor\b|\bscreen\b|\bsignage\b/i, "monitor"],
  [/\bkeyboard\b/i, "keyboard"],
  [/\bmouse\b/i, "mouse"],
  [/\btelephone\b|\bgrand ?stream\b/i, "telephone"],
  [/\bmike\b|\bmic\b/i, "speaker"],
  [/\bcpu\b|\bpc\b|\bsystem\b|\blenovo\b/i, "mini_pc"],
  [/\btv\b/i, "monitor"],
  [/\bfire extinguisher\b|\bfirst aid\b/i, "first_aid"],
];
export function fixtureCategory(name: string): string {
  // A label naming two things ("Monitor Keyboard Mouse") is a set, not one of
  // them; leaving it as furniture keeps it out of the monitor count.
  const hits = FIXTURE_WORDS.filter(([rx]) => rx.test(name));
  return hits.length === 1 ? hits[0][1] : "furniture";
}
