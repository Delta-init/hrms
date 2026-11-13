/** Shared formatting for the ad spend screens. */

export const money = (n: number, currency = "AED", decimals = 2) =>
  `${n.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${currency}`;

export const monthLabel = (month: string, long = false) =>
  new Intl.DateTimeFormat("en-GB", { month: long ? "long" : "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T00:00:00Z`));

export const dayLabel = (key: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${key}T00:00:00Z`));

export const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

const DAY_MS = 86_400_000;
export const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const mondayOf = (key: string) => addDays(key, -((new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7));

/** "2–8 Nov 2026", or "27 Oct – 2 Nov 2026" across a month end. */
export function weekLabel(weekStart: string) {
  const end = addDays(weekStart, 6);
  const fmt = (k: string, year: boolean) =>
    new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(`${k}T00:00:00Z`));
  return weekStart.slice(0, 7) === end.slice(0, 7) ? `${Number(weekStart.slice(8))}–${fmt(end, true)}` : `${fmt(weekStart, false)} – ${fmt(end, true)}`;
}

export function addMonths(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** One colour per platform, by its place in the list — the same in every chart and legend. */
const SWATCHES = ["bg-sky-500", "bg-emerald-500", "bg-orange-500", "bg-violet-500", "bg-pink-500", "bg-amber-500", "bg-teal-500", "bg-rose-500"];
export const swatch = (index: number) => SWATCHES[index % SWATCHES.length];
