/**
 * Counting a new joiner's first days.
 *
 * Two clocks, on purpose. The red portal runs for fifteen calendar days from
 * the joining date — a fortnight is a fortnight whatever the rota says. The
 * steps run on working days: "day 2" is the next day they actually work, so
 * somebody who joins on a Saturday is not handed homework due on their Sunday
 * off, or on a public holiday.
 *
 * Days are "YYYY-MM-DD" keys in the joiner's own time zone throughout.
 */

/** How long the red portal lasts, counting the joining day as day 1. */
export const FIRST_DAYS_LENGTH = 15;

/** Day 1's session runs 10:30 until the break at 1 pm; it can be confirmed from then. */
export const SESSION_ENDS_AT = "13:00";
/** Day 2's role-play opens in the afternoon. */
export const ROLE_PLAY_OPENS_AT = "13:00";

const DAY_MS = 86_400_000;

/** A key `n` calendar days on from `key`. */
export const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * The calendar day a joining date stands for.
 *
 * The employee form stores the picked date as UTC midnight; rounding to the
 * nearest midnight first means a date that went in as local midnight somewhere
 * east or west of UTC still lands on the day it was picked for.
 */
export const joiningDayKey = (d: Date | string) =>
  new Date(Math.round(new Date(d).getTime() / DAY_MS) * DAY_MS).toISOString().slice(0, 10);

/** Day N of the first days, the joining day being 1. Zero or less before it, past 15 after. */
export const dayNumber = (startKey: string, todayKey: string) =>
  Math.round((Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${startKey}T00:00:00Z`)) / DAY_MS) + 1;

/** The last day the portal is red — the 15th, counting the joining day. */
export const lastRedDay = (startKey: string) => addDays(startKey, FIRST_DAYS_LENGTH - 1);

/**
 * The first `count` working days, starting with the joining day itself (they
 * are there on day 1 whatever day of the week it is). Each next one is the
 * next day on their schedule that is not a holiday for them.
 *
 * `workDays` is 0 = Sunday … 6 = Saturday. Gives up after two months of
 * nothing, so a schedule with no working days cannot loop forever.
 */
export function workingDayKeys(startKey: string, count: number, workDays: number[], holidays: Set<string>): string[] {
  const out = [startKey];
  let key = startKey;
  for (let guard = 0; out.length < count && guard < 60; guard++) {
    key = addDays(key, 1);
    const weekday = new Date(`${key}T00:00:00Z`).getUTCDay();
    if (workDays.includes(weekday) && !holidays.has(key)) out.push(key);
  }
  return out;
}

/** A link the joiner says is their ChatGPT conversation — a shared chat, not the app's home page. */
export function isChatGptShareLink(link: string): boolean {
  try {
    const url = new URL(link.trim());
    return url.protocol === "https:"
      && ["chatgpt.com", "www.chatgpt.com", "chat.openai.com"].includes(url.hostname)
      && /^\/share\/[\w-]+/.test(url.pathname);
  } catch {
    return false;
  }
}
