/* Copy of hrms-backend/src/utils/taskRepeat.ts — keep the two the same, so the form previews exactly what the server makes.
 *
 * When a repeating task falls due (2026-11-25, Tasks Part 2). Dates are the office's calendar days as
 * "YYYY-MM-DD" strings, so a weekly Monday task is Monday in Dubai whatever the server's clock says.
 *
 *   daily      every day from the start
 *   weekly     the chosen weekdays (0 = Monday … 6 = Sunday)
 *   interval   every N days from the start
 *
 * It ends after a number of times (all the people's copies for one date count as one time), on a date
 * (inclusive), or never.
 */

export type RepeatKind = "daily" | "weekly" | "interval";
export interface RepeatRule {
  kind: RepeatKind;
  weekdays?: number[];
  everyDays?: number;
  startDate: string;
  ends: { kind: "count" | "date" | "never"; count?: number | null; date?: string | null };
}

const DAY = 86_400_000;
const toUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fromUtc(toUtc(d) + n * DAY);
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY);
/** 0 = Monday. */
export const weekdayOf = (d: string) => (new Date(toUtc(d)).getUTCDay() + 6) % 7;

export function matches(rule: RepeatRule, d: string): boolean {
  if (d < rule.startDate) return false;
  if (rule.kind === "daily") return true;
  if (rule.kind === "weekly") return (rule.weekdays ?? []).includes(weekdayOf(d));
  const n = Math.max(1, rule.everyDays ?? 1);
  return daysBetween(rule.startDate, d) % n === 0;
}

/**
 * The dates still to make: after `after` (the last date made; null for none yet), up to and including `upTo`,
 * stopping at the end of the rule. `made` is how many dates were made before, for an end after N times.
 * Never returns more than `limit` dates, so a series left alone for a year can't flood anyone.
 */
export function datesToMake(rule: RepeatRule, after: string | null, upTo: string, made = 0, limit = 31): string[] {
  const out: string[] = [];
  const cap = rule.ends.kind === "count" ? Math.max(0, (rule.ends.count ?? 0) - made) : Infinity;
  let d = after && after >= rule.startDate ? addDays(after, 1) : rule.startDate;
  for (let guard = 0; d <= upTo && out.length < Math.min(cap, limit) && guard < 3660; guard++, d = addDays(d, 1)) {
    if (rule.ends.kind === "date" && rule.ends.date && d > rule.ends.date) break;
    if (matches(rule, d)) out.push(d);
  }
  return out;
}

/** The next `n` dates from `from` (inclusive) — for showing what's coming. */
export function upcoming(rule: RepeatRule, from: string, made = 0, n = 5): string[] {
  return datesToMake(rule, from > rule.startDate ? addDays(from, -1) : null, addDays(from, 3650), made, n);
}

/** Whether the rule can produce no further dates after `after`. */
export function finished(rule: RepeatRule, after: string | null, made: number): boolean {
  if (rule.ends.kind === "count") return made >= (rule.ends.count ?? 0);
  if (rule.ends.kind === "date") return !!after && !!rule.ends.date && after >= rule.ends.date;
  return false;
}

/** "Every day", "Every Mon, Thu", "Every 3 days" — for lists and notices. */
export function describe(rule: Pick<RepeatRule, "kind" | "weekdays" | "everyDays">): string {
  if (rule.kind === "daily") return "Every day";
  if (rule.kind === "interval") return `Every ${rule.everyDays ?? 1} days`;
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days = [...(rule.weekdays ?? [])].sort((a, b) => a - b);
  if (days.length === 5 && days.every((d, i) => d === i)) return "Every weekday";
  return `Every ${days.map((d) => names[d]).join(", ")}`;
}
