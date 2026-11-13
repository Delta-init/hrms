/**
 * The arithmetic behind the recruitment ad spend tracker.
 *
 * A week runs Monday to Sunday and is named by its Monday, as a "YYYY-MM-DD"
 * key in the organisation's own time zone. Money is kept to two decimals and
 * rounded on the way in, so a total read back is always the sum of the parts
 * as shown — the spreadsheet this replaced lost 9% of its spend to amounts
 * typed as text and formulas that skipped a column; nothing here is a formula.
 */

const DAY_MS = 86_400_000;

const parseKey = (key: string) => Date.parse(`${key}T00:00:00Z`);
const toKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A day key `n` days on from `key`. */
export const addDays = (key: string, n: number) => toKey(parseKey(key) + n * DAY_MS);

/** Whether `key` is a real calendar day written as YYYY-MM-DD. */
export function isDayKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const ms = parseKey(key);
  return Number.isFinite(ms) && toKey(ms) === key;
}

/** The Monday of the week `key` falls in. */
export function mondayOf(key: string): string {
  const weekday = new Date(parseKey(key)).getUTCDay(); // 0 = Sunday
  return addDays(key, -((weekday + 6) % 7));
}

export const isMonday = (key: string) => isDayKey(key) && mondayOf(key) === key;

/** The Sunday a week ends on. */
export const weekEnd = (weekStart: string) => addDays(weekStart, 6);

/** The week that finished most recently, seen from `todayKey`: last Monday-to-Sunday. */
export const lastCompletedWeek = (todayKey: string) => addDays(mondayOf(todayKey), -7);

/** Every Monday from `from` to `to`, both included (both must be Mondays). */
export function weeksBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let key = from; key <= to && out.length < 1000; key = addDays(key, 7)) out.push(key);
  return out;
}

/**
 * The finished weeks nobody has logged, from when the tracker started counting.
 *
 * The week under way is never missing — it has not ended. Nor is anything
 * before `trackingFrom`: history imported from the old sheet has gaps that
 * were never anybody's job to fill, and reporting them would bury the one
 * week that actually is late.
 */
export function missingWeeks(trackingFrom: string | null | undefined, todayKey: string, logged: Iterable<string>): string[] {
  if (!trackingFrom || !isDayKey(trackingFrom)) return [];
  const last = lastCompletedWeek(todayKey);
  const from = mondayOf(trackingFrom);
  if (from > last) return [];
  const have = new Set(logged);
  return weeksBetween(from, last).filter((w) => !have.has(w));
}

/** Money to two decimals, without the float residue (0.1 + 0.2). */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * The month a week's spend counts in: the one holding most of its days, which
 * is the month its Thursday falls in. A week of 29 June to 5 July is July's.
 * Splitting a week's figure across two months by day would invent numbers
 * nobody entered.
 */
export const monthOfWeek = (weekStart: string) => addDays(weekStart, 3).slice(0, 7);

/**
 * The Mondays to fetch for a run of months: every week that could count in
 * them, to be narrowed with monthOfWeek — a month's first week can start up
 * to three days before the 1st.
 */
export const weekRangeForMonths = (from: string, to: string) => ({ $gte: addDays(`${from}-01`, -3), $lte: `${to}-31` });

/** Every "YYYY-MM" from `from` to `to`, both included. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 240) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** The month `n` months on from "YYYY-MM". */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** A platform key from its name: "Bayt.com" → "bayt-com". */
export const platformKey = (label: string) =>
  label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Whether a candidate's recorded source is this platform.
 *
 * New candidates have the platform's name picked from a list, so that is an
 * exact match. The prefix covers what was typed before the list existed —
 * "Meta Ads" is Meta, "LinkedIn Jobs" is LinkedIn — without any guessing
 * beyond the name itself.
 */
export function sourceIsPlatform(source: string | null | undefined, platform: { key: string; label: string }): boolean {
  const s = squash(source ?? "");
  if (!s) return false;
  const label = squash(platform.label);
  const key = squash(platform.key);
  return (!!label && s.startsWith(label)) || (!!key && s.startsWith(key));
}

export interface SpendLine {
  role: string;
  amounts: { platform: string; amount: number }[];
}

/** One role's spend across its platforms. */
export const lineTotal = (line: SpendLine) => round2(line.amounts.reduce((sum, a) => sum + (a.amount || 0), 0));

/** A whole week's spend. */
export const weekTotal = (lines: SpendLine[]) => round2(lines.reduce((sum, l) => sum + lineTotal(l), 0));

/**
 * Tidy a week as typed: amounts rounded, nothing-spent cells dropped, and the
 * same role entered twice folded into one line — two rows for one role is how
 * the old sheet ended up with "(reposted on …)" variants that never added up.
 * A role is the same role when the hiring request is the same, or, without
 * one, when the name is the same ignoring case and spacing.
 */
export function tidyLines<T extends SpendLine & { requisition?: string | null; note?: string }>(lines: T[]): T[] {
  const byRole = new Map<string, T>();
  for (const raw of lines) {
    const role = raw.role.trim().replace(/\s+/g, " ");
    const amounts = raw.amounts
      .map((a) => ({ platform: a.platform, amount: round2(Number(a.amount) || 0) }))
      .filter((a) => a.amount > 0);
    const id = raw.requisition ? `req:${raw.requisition}` : `name:${role.toLowerCase()}`;
    const existing = byRole.get(id);
    if (!existing) {
      byRole.set(id, { ...raw, role, amounts, note: raw.note?.trim() || "" });
      continue;
    }
    for (const a of amounts) {
      const same = existing.amounts.find((x) => x.platform === a.platform);
      if (same) same.amount = round2(same.amount + a.amount);
      else existing.amounts.push(a);
    }
    const note = raw.note?.trim();
    if (note) existing.note = existing.note ? `${existing.note}; ${note}` : note;
  }
  return [...byRole.values()].filter((l) => l.amounts.length > 0);
}
