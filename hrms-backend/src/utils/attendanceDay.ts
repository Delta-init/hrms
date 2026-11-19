import { localDayKey } from "./schedule.js";

/**
 * One attendance record per person per day.
 *
 * A record is filed under midnight of its day in its own time zone, so the
 * same day has a different stored date in Dubai and in Kolkata — ninety
 * minutes apart. Writers used to look a day up by that exact stored date, and
 * a correction made under one zone for a punch filed under the other did not
 * find it: it added a second record, and pay counted both, docking a day the
 * correction had just made good (28 such days by November 2026).
 *
 * The day itself — `localDay`, "YYYY-MM-DD" in the record's own zone — is the
 * same under either filing, so that is what identifies it. When there are
 * several anyway, the one that counts is the one changed last: a correction is
 * always a later change than the punch it corrects.
 */

export interface DayRecordLike {
  _id?: unknown;
  date: Date | string;
  timeZone?: string | null;
  localDay?: string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

/** The local day a record stands for: its stored day, else worked out from its own zone. */
export const dayOfRecord = (a: DayRecordLike): string =>
  a.localDay || localDayKey(a.date, a.timeZone || "Asia/Dubai");

const stamp = (v: Date | string | null | undefined) => (v ? new Date(v).getTime() : 0);

/** Which of two records for one day counts: the one changed last, then the one made last. */
export function laterRecord<T extends DayRecordLike>(a: T, b: T): T {
  const byUpdate = stamp(b.updatedAt) - stamp(a.updatedAt);
  if (byUpdate) return byUpdate > 0 ? b : a;
  const byCreate = stamp(b.createdAt) - stamp(a.createdAt);
  if (byCreate) return byCreate > 0 ? b : a;
  return String(b._id ?? "") > String(a._id ?? "") ? b : a;
}

/** Records reduced to one per day — the one that counts — in date order. */
export function onePerDay<T extends DayRecordLike>(records: T[]): T[] {
  const byDay = new Map<string, T>();
  for (const r of records) {
    const day = dayOfRecord(r);
    const held = byDay.get(day);
    byDay.set(day, held ? laterRecord(held, r) : r);
  }
  return Array.from(byDay.values()).sort((a, b) => stamp(a.date) - stamp(b.date));
}
