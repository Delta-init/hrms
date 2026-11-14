import { describe, expect, it } from "bun:test";
import { daysUntil, dueReminder, whenText } from "./visaReminders.js";

const due = (expiryDay: string, today: string, sent: string[] = [], paused = false) =>
  dueReminder({ expiryDay, today, sent: new Set(sent), paused });

describe("dueReminder", () => {
  it("says nothing more than 30 days out", () => {
    expect(due("2026-12-31", "2026-11-14")).toBeNull();
  });

  it("sends each milestone on its day", () => {
    expect(due("2026-12-14", "2026-11-14")).toEqual({ key: "before-30", daysLeft: 30, stage: "before" });
    expect(due("2026-11-29", "2026-11-14")?.key).toBe("before-15");
    expect(due("2026-11-19", "2026-11-14")?.key).toBe("before-5");
    expect(due("2026-11-16", "2026-11-14")?.key).toBe("before-2");
    expect(due("2026-11-15", "2026-11-14")?.key).toBe("before-1");
  });

  it("sends nothing between milestones once a milestone is out", () => {
    expect(due("2026-11-24", "2026-11-14", ["before-15"])).toBeNull(); // 10 days left
  });

  it("catches up a milestone a missed run skipped — but not long after", () => {
    expect(due("2026-11-27", "2026-11-14")).toEqual({ key: "before-15", daysLeft: 13, stage: "before" });
    expect(due("2026-11-25", "2026-11-14")).toBeNull(); // 11 days left: 15 was four days ago
  });

  it("never sends the same one twice", () => {
    expect(due("2026-11-19", "2026-11-14", ["before-5"])).toBeNull();
  });

  it("sends on the day, then every day after", () => {
    expect(due("2026-11-14", "2026-11-14")).toEqual({ key: "day", daysLeft: 0, stage: "day" });
    expect(due("2026-11-11", "2026-11-14")).toEqual({ key: "after-3", daysLeft: -3, stage: "after" });
    expect(due("2026-11-11", "2026-11-14", ["after-3"])).toBeNull();
    expect(due("2026-09-01", "2026-11-14")?.key).toBe("after-74");
  });

  it("pauses after expiry while somebody is on it, but not before it", () => {
    expect(due("2026-11-11", "2026-11-14", [], true)).toBeNull();
    expect(due("2026-11-16", "2026-11-14", [], true)?.key).toBe("before-2");
  });
});

describe("words", () => {
  it("counts days and says when", () => {
    expect(daysUntil("2026-11-29", "2026-11-14")).toBe(15);
    expect(whenText(15)).toBe("in 15 days");
    expect(whenText(1)).toBe("tomorrow");
    expect(whenText(0)).toBe("today");
    expect(whenText(-1)).toBe("1 day ago");
    expect(whenText(-6)).toBe("6 days ago");
  });
});
