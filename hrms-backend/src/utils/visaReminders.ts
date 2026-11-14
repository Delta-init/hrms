/**
 * When a visa reminder is due.
 *
 * Before the expiry: at 30, 15, 5, 2 and 1 days left. On the day itself. After
 * it, every day until a new visa is approved — paused while one is waiting for
 * HR or an accepted renewal is still inside its 30 days, since then somebody
 * is already dealing with it.
 *
 * Each reminder has a key, and the job keeps a log of the keys it sent for a
 * given expiry date, so a run that happens twice sends nothing twice. A new
 * visa has a new expiry date, so its countdown starts clean.
 */

/** Days before the expiry at which a reminder goes out. */
export const MILESTONES = [30, 15, 5, 2, 1] as const;

/** A milestone missed by a run that did not happen is still sent this many days late — not longer. */
export const CATCH_UP_DAYS = 2;

const DAY_MS = 86_400_000;

/** Whole days from `today` to `expiryDay`: positive before, 0 on the day, negative after. */
export const daysUntil = (expiryDay: string, today: string) =>
  Math.round((Date.parse(`${expiryDay}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);

export interface DueReminder {
  /** What the log records: "before-15", "day", "after-3". */
  key: string;
  /** Days left — negative once expired. What the message says, whatever the milestone. */
  daysLeft: number;
  stage: "before" | "day" | "after";
}

export function dueReminder(input: { expiryDay: string; today: string; sent: Set<string>; paused: boolean }): DueReminder | null {
  const daysLeft = daysUntil(input.expiryDay, input.today);
  if (daysLeft > MILESTONES[0]) return null;

  if (daysLeft > 0) {
    // The latest milestone already reached: with 14 days left that is the 15.
    const milestone = [...MILESTONES].sort((a, b) => a - b).find((m) => m >= daysLeft)!;
    if (milestone - daysLeft > CATCH_UP_DAYS) return null;
    const key = `before-${milestone}`;
    return input.sent.has(key) ? null : { key, daysLeft, stage: "before" };
  }

  if (daysLeft === 0) return input.sent.has("day") ? null : { key: "day", daysLeft, stage: "day" };

  // Expired: one a day, unless somebody is already on it.
  if (input.paused) return null;
  const key = `after-${-daysLeft}`;
  return input.sent.has(key) ? null : { key, daysLeft, stage: "after" };
}

/** "in 15 days", "tomorrow", "today", "1 day ago", "6 days ago". */
export function whenText(daysLeft: number): string {
  if (daysLeft > 1) return `in ${daysLeft} days`;
  if (daysLeft === 1) return "tomorrow";
  if (daysLeft === 0) return "today";
  return daysLeft === -1 ? "1 day ago" : `${-daysLeft} days ago`;
}
