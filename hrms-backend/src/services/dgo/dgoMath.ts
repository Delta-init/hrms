/**
 * DGO Points arithmetic, kept pure so it can be tested without a database.
 *
 * Money is held in fils (AED × 100) as integers everywhere it is stored or
 * compared, so that 20 points at AED 0.05 is exactly 100 fils and a budget can
 * never be overspent by a rounding error. Points are integers.
 */

export interface DgoTier {
  /** Eligible collections (AED) from which this tier applies. */
  minCollections: number;
  everydayAed: number;
  eliteAed: number;
}

export const toFils = (aed: number): number => Math.round(aed * 100);
export const toAed = (fils: number): number => Math.round(fils) / 100;

/** What a number of points is worth, in fils. */
export const pointsToFils = (points: number, pointValueAed: number): number => Math.round(points * pointValueAed * 100);

/** The tier a month's eligible collections reach: the highest whose minimum it meets. Null collections → the lowest. */
export function tierFor(collectionsAed: number | null, tiers: DgoTier[]): { index: number; tier: DgoTier } {
  const sorted = [...tiers].sort((a, b) => a.minCollections - b.minCollections);
  let index = 0;
  if (collectionsAed !== null) {
    sorted.forEach((t, i) => { if (collectionsAed >= t.minCollections) index = i; });
  }
  return { index, tier: sorted[index] };
}

const fmtAed = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(2)}m` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n));

/** "Under AED 800k", "AED 800k – 1m", "AED 1.2m and over". */
export function tierLabel(index: number, tiers: DgoTier[]): string {
  const sorted = [...tiers].sort((a, b) => a.minCollections - b.minCollections);
  const t = sorted[index];
  const next = sorted[index + 1];
  if (!t) return "—";
  if (index === 0 && t.minCollections === 0) return next ? `Under AED ${fmtAed(next.minCollections)}` : "Any";
  if (!next) return `AED ${fmtAed(t.minCollections)} and over`;
  return `AED ${fmtAed(t.minCollections)} – ${fmtAed(next.minCollections)}`;
}

export interface AllocationInput { key: string; group: "revenue" | "other"; headcount: number }

/**
 * Split the everyday pool between departments: the revenue group's share and the
 * other group's share, each divided by headcount. Largest remainder keeps every
 * group's total exact to the fil. A group with nobody in it gets nothing.
 */
export function splitAllocations(poolFils: number, revenueSharePct: number, depts: AllocationInput[]): Map<string, number> {
  const out = new Map<string, number>();
  const groupShare = {
    revenue: Math.round((poolFils * revenueSharePct) / 100),
    other: poolFils - Math.round((poolFils * revenueSharePct) / 100),
  };
  for (const group of ["revenue", "other"] as const) {
    const members = depts.filter((d) => d.group === group);
    const heads = members.reduce((s, d) => s + Math.max(0, d.headcount), 0);
    if (!heads) { members.forEach((d) => out.set(d.key, 0)); continue; }
    const exact = members.map((d) => ({ key: d.key, raw: (groupShare[group] * Math.max(0, d.headcount)) / heads }));
    const floors = exact.map((e) => ({ key: e.key, fils: Math.floor(e.raw), rem: e.raw - Math.floor(e.raw) }));
    let left = groupShare[group] - floors.reduce((s, f) => s + f.fils, 0);
    [...floors].sort((a, b) => b.rem - a.rem || a.key.localeCompare(b.key)).forEach((f) => { if (left > 0) { f.fils += 1; left -= 1; } });
    floors.forEach((f) => out.set(f.key, f.fils));
  }
  return out;
}

export interface CapInput {
  /** Points already counted today (pending or posted), not counting cap-exempt ones. */
  usedTotal: number;
  /** Of those, automatic KPI points. */
  usedAuto: number;
  points: number;
  isAuto: boolean;
  capExempt: boolean;
  dailyCap: number;
  autoCap: number;
}

/** Whether one more award fits the day. Innovation (cap-exempt) always fits the cap; the budget still applies. */
export function capCheck(c: CapInput): { ok: true } | { ok: false; reason: string } {
  if (c.capExempt) return { ok: true };
  if (c.usedTotal + c.points > c.dailyCap) {
    return { ok: false, reason: `Over the daily cap: ${c.usedTotal} of ${c.dailyCap} points already used that day` };
  }
  if (c.isAuto && c.usedAuto + c.points > c.autoCap) {
    return { ok: false, reason: `Over the KPI cap: ${c.usedAuto} of ${c.autoCap} KPI points already used that day` };
  }
  return { ok: true };
}

/** "YYYY-MM-DD" of an instant in a time zone. */
export const dayIn = (tz: string, at: Date = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

export const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const isMonth = (s: unknown): s is string => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** The month before "YYYY-MM". */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * The same calendar day some months later, for expiry. A day that month lacks
 * (31 Jan + 1 month) lands on that month's last day.
 */
export function addMonthsToDay(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
