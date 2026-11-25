import { describe as group, expect, test } from "bun:test";
import { datesToMake, upcoming, finished, describe, weekdayOf, type RepeatRule } from "./taskRepeat";

const rule = (r: Partial<RepeatRule>): RepeatRule => ({ kind: "daily", startDate: "2026-11-30", ends: { kind: "never" }, ...r });

group("taskRepeat", () => {
  test("weekdays: 30 Nov 2026 is a Monday", () => {
    expect(weekdayOf("2026-11-30")).toBe(0);
    expect(weekdayOf("2026-12-06")).toBe(6);
  });

  test("daily makes every day up to today, nothing before the start", () => {
    expect(datesToMake(rule({}), null, "2026-11-29")).toEqual([]);
    expect(datesToMake(rule({}), null, "2026-12-02")).toEqual(["2026-11-30", "2026-12-01", "2026-12-02"]);
    expect(datesToMake(rule({}), "2026-12-01", "2026-12-02")).toEqual(["2026-12-02"]);
  });

  test("weekly keeps to the chosen days", () => {
    const r = rule({ kind: "weekly", weekdays: [0, 3] }); // Mon, Thu
    expect(datesToMake(r, null, "2026-12-13")).toEqual(["2026-11-30", "2026-12-03", "2026-12-07", "2026-12-10"]);
  });

  test("every N days counts from the start", () => {
    const r = rule({ kind: "interval", everyDays: 3 });
    expect(datesToMake(r, null, "2026-12-09")).toEqual(["2026-11-30", "2026-12-03", "2026-12-06", "2026-12-09"]);
    expect(datesToMake(r, "2026-12-03", "2026-12-07")).toEqual(["2026-12-06"]);
  });

  test("ends after N times, counting what was already made", () => {
    const r = rule({ ends: { kind: "count", count: 3 } });
    expect(datesToMake(r, null, "2026-12-10")).toEqual(["2026-11-30", "2026-12-01", "2026-12-02"]);
    expect(datesToMake(r, "2026-12-01", "2026-12-10", 2)).toEqual(["2026-12-02"]);
    expect(datesToMake(r, "2026-12-02", "2026-12-10", 3)).toEqual([]);
    expect(finished(r, "2026-12-02", 3)).toBe(true);
  });

  test("ends on a date, inclusive", () => {
    const r = rule({ ends: { kind: "date", date: "2026-12-01" } });
    expect(datesToMake(r, null, "2026-12-10")).toEqual(["2026-11-30", "2026-12-01"]);
    expect(finished(r, "2026-12-01", 2)).toBe(true);
    expect(finished(r, "2026-11-30", 1)).toBe(false);
  });

  test("never makes more than the limit at once", () => {
    expect(datesToMake(rule({}), null, "2027-06-01").length).toBe(31);
  });

  test("upcoming lists the next dates from a day", () => {
    expect(upcoming(rule({ kind: "weekly", weekdays: [4] }), "2026-11-25", 0, 3)).toEqual(["2026-12-04", "2026-12-11", "2026-12-18"]);
  });

  test("describes itself in words", () => {
    expect(describe({ kind: "daily" })).toBe("Every day");
    expect(describe({ kind: "interval", everyDays: 3 })).toBe("Every 3 days");
    expect(describe({ kind: "weekly", weekdays: [3, 0] })).toBe("Every Mon, Thu");
    expect(describe({ kind: "weekly", weekdays: [0, 1, 2, 3, 4] })).toBe("Every weekday");
  });
});
