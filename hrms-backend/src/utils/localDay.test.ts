import { describe, expect, it } from "bun:test";
import { localDayKey, DEFAULT_WORK_DAYS } from "./schedule.js";

/**
 * The day an attendance row belongs to.
 *
 * Attendance stores a day as its local midnight expressed in UTC: a Dubai day
 * of the 7th is 20:00Z on the 6th, an Indian one 18:30Z on the 6th. Reading
 * those back with `toISOString().slice(0, 10)` — which is what the comp-off
 * suggestion did — lands a day earlier.
 *
 * The consequence was not subtle. Every Monday read as a Sunday and earned a
 * comp-off day for ordinary work, while the genuine Sunday behind it read as a
 * Saturday, which is a working day here, and earned nothing. Forty-eight
 * credits were granted this way and not one of them fell on a Sunday.
 */
const DUBAI = "Asia/Dubai";
const INDIA = "Asia/Kolkata";

/** Monday 07 Sept 2026, as attendance stores it in each zone. */
const MONDAY_DUBAI = new Date("2026-09-06T20:00:00.000Z");
const MONDAY_INDIA = new Date("2026-09-06T18:30:00.000Z");
/** Sunday 06 Sept 2026, the day people actually worked. */
const SUNDAY_DUBAI = new Date("2026-09-05T20:00:00.000Z");

const weekdayOf = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay();

describe("the day an attendance row belongs to", () => {
  it("reads a stored local midnight as its own local day", () => {
    expect(localDayKey(MONDAY_DUBAI, DUBAI)).toBe("2026-09-07");
    expect(localDayKey(MONDAY_INDIA, INDIA)).toBe("2026-09-07");
    expect(localDayKey(SUNDAY_DUBAI, DUBAI)).toBe("2026-09-06");
  });

  it("is a day ahead of what reading it as UTC gives", () => {
    // The old behaviour, kept here so the difference is visible rather than
    // asserted in the abstract.
    expect(MONDAY_DUBAI.toISOString().slice(0, 10)).toBe("2026-09-06");
    expect(localDayKey(MONDAY_DUBAI, DUBAI)).toBe("2026-09-07");
  });

  it("calls Monday a working day and Sunday a weekend", () => {
    const monday = weekdayOf(localDayKey(MONDAY_DUBAI, DUBAI));
    const sunday = weekdayOf(localDayKey(SUNDAY_DUBAI, DUBAI));

    expect(monday).toBe(1);
    expect(sunday).toBe(0);
    // Mon–Sat is the working week, so only the Sunday earns comp-off.
    expect(DEFAULT_WORK_DAYS.includes(monday)).toBe(true);
    expect(DEFAULT_WORK_DAYS.includes(sunday)).toBe(false);
  });

  it("would have called that Monday a weekend before the fix", () => {
    const asUtc = new Date(MONDAY_DUBAI).getUTCDay();
    expect(asUtc).toBe(0); // Sunday
    expect(DEFAULT_WORK_DAYS.includes(asUtc)).toBe(false); // → credited, wrongly
  });
});
