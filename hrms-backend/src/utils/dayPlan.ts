/*
 * Times on a day plan (2026-11-26, Tasks · Day plans). The frontend has a copy at hrms-frontend/lib/dayPlan.ts —
 * keep the two the same, so what he sees is what the server records.
 *
 * Tasks run one after another from the day's start, each for its own length. A task with a fixed time (lunch,
 * closing) starts at that time: spare minutes before it are free time, and if the tasks before it run over, it
 * starts late and says by how much. So inserting a task moves everything after it later, up to the next fixed one.
 */

export interface PlanItemLike { mins: number; fixedAt?: string | null }
export interface Slot { start: number; end: number; free: number; over: number }

/** "HH:MM" → minutes after midnight. */
export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
/** Minutes after midnight → "HH:MM". */
export const toHHMM = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function schedule(startAt: string, items: PlanItemLike[]): Slot[] {
  let t = toMin(startAt);
  return items.map((it) => {
    const fixed = it.fixedAt ? toMin(it.fixedAt) : null;
    const free = fixed != null && fixed > t ? fixed - t : 0;
    const over = fixed != null && t > fixed ? t - fixed : 0;
    const start = fixed != null ? Math.max(t, fixed) : t;
    const end = start + Math.max(0, it.mins);
    t = end;
    return { start, end, free, over };
  });
}
