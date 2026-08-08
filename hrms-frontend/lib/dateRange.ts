/**
 * Calendar-date arithmetic on YYYY-MM-DD strings.
 *
 * These are plain calendar days, not instants, so every operation goes through
 * UTC to keep the arithmetic free of the viewer's own offset. Which day "today"
 * is comes from `dayKeyIn`, which asks a specific timezone — the rest just
 * counts days from there.
 */

/** The calendar day `instant` falls on, seen from `tz`. */
export function dayKeyIn(instant: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant);
}

const parse = (key: string) => new Date(`${key}T00:00:00.000Z`);
const format = (d: Date) => d.toISOString().slice(0, 10);

export function shiftDays(key: string, days: number): string {
  const d = parse(key);
  d.setUTCDate(d.getUTCDate() + days);
  return format(d);
}

/** Sunday of the week containing `key`, matching the attendance calendar grid. */
export function startOfWeek(key: string): string {
  return shiftDays(key, -parse(key).getUTCDay());
}

export function startOfMonth(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

export function endOfMonth(key: string): string {
  const d = parse(key);
  return format(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}
