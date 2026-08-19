import * as path from "node:path";
import * as fs from "node:fs";
import * as XLSX from "xlsx";

/**
 * Reading the GreytHR exports.
 *
 * Two quirks worth knowing. Every sheet opens with a one-cell title banner, so
 * the real header is the widest of the first few rows rather than row one. And
 * the workbooks declare a 1x1 dimension, which streaming readers believe — this
 * reads the whole sheet rather than trusting it.
 */

export type Row = Record<string, string>;

const clean = (v: unknown): string =>
  v === null || v === undefined ? "" : String(v).trim();

/**
 * The newest export matching a base name.
 *
 * These land in a downloads folder, and a second pull of the same report is
 * saved as "LeaveInfo (2).xlsx" beside the first. Taking the highest suffix
 * means a re-export is picked up without anyone renaming files, and the whole
 * point of a re-export is that it is the one you meant.
 *
 * Case-insensitive, because GreytHR is inconsistent about it — "leaveinfo" and
 * "LeaveInfo" are the same report on different days.
 */
export function pickSheet(dir: string, base: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const stem = base.replace(/\.xlsx$/i, "").toLowerCase();
  const candidates = fs.readdirSync(dir).filter((f) => {
    const m = /^(.*?)(?: \((\d+)\))?\.xlsx$/i.exec(f);
    return !!m && m[1].toLowerCase() === stem;
  });
  if (!candidates.length) return null;
  const suffix = (f: string) => Number(/ \((\d+)\)\.xlsx$/i.exec(f)?.[1] ?? 0);
  return candidates.sort((a, b) => suffix(b) - suffix(a))[0];
}

export function readSheet(dir: string, file: string): Row[] {
  const picked = pickSheet(dir, file);
  const full = path.join(dir, picked ?? file);
  if (!fs.existsSync(full)) return [];
  const wb = XLSX.readFile(full, { cellDates: false, raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: "" });
  const rows = grid.filter((r) => r.some((v) => clean(v) !== ""));
  if (!rows.length) return [];

  let headerIndex = 0;
  let widest = -1;
  for (let i = 0; i < Math.min(4, rows.length); i++) {
    const filled = rows[i].filter((v) => clean(v) !== "").length;
    if (filled > widest) { widest = filled; headerIndex = i; }
  }
  const header = rows[headerIndex].map(clean);

  return rows
    .slice(headerIndex + 1)
    // Every sheet ends "Total number of records : 99", which lands in whatever
    // the first column happens to be — read as data it becomes an employee
    // called nothing, with a code of "Total number of records : 99".
    .filter((r) => !r.some((v) => /^total number of records/i.test(clean(v))))
    .map((r) => {
      const out: Row = {};
      header.forEach((h, i) => { if (h) out[h] = clean(r[i]); });
      return out;
    });
}

/** E0022, D0001, T003 — anything else in that column is not a person. */
export const isEmployeeCode = (s: string): boolean => /^[A-Z]{1,2}\d{3,6}$/i.test(s.trim());

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/**
 * "01 JAN 2026", "01 Jan 2022", "08 JUN 2026 18.42.57" — GreytHR's own formats.
 *
 * Parsed as UTC midnight deliberately: these are calendar days (a joining date,
 * a visa expiry), and letting the server's timezone shift them moves somebody's
 * start date by a day depending on where the import is run.
 */
export function parseDate(v: string | undefined): Date | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const m = /^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -](\d{4})/.exec(s);
  if (!m) return null;
  const month = MONTHS[m[2].toUpperCase()];
  if (month === undefined) return null;
  const d = new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseNumber(v: string | undefined): number | null {
  const s = (v ?? "").replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "Sales Department" and "SALES DEPARTMENT" are the same department. */
export const normalise = (s: string): string =>
  s.toLowerCase().replace(/\bdepartments?\b/g, "").replace(/[^a-z0-9]/g, "");
