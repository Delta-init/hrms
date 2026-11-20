import { describe, expect, test } from "bun:test";
import { addMonthsToDay, capCheck, pointsToFils, previousMonth, splitAllocations, tierFor, tierLabel, toAed } from "./dgoMath.js";
import { DEFAULT_SETTINGS } from "./dgoDefaults.js";

const tiers = DEFAULT_SETTINGS.tiers;

describe("DGO Points arithmetic", () => {
  test("points to money is exact in fils", () => {
    expect(pointsToFils(20, 0.05)).toBe(100);
    expect(pointsToFils(30, 0.05)).toBe(150);
    expect(pointsToFils(95_000, 0.05)).toBe(475_000);
    expect(toAed(pointsToFils(8450, 0.05))).toBe(422.5);
  });

  test("tiers from the handoff", () => {
    expect(tierFor(null, tiers).tier.everydayAed).toBe(1500);
    expect(tierFor(799_999.99, tiers).tier.everydayAed).toBe(1500);
    expect(tierFor(800_000, tiers).tier.everydayAed).toBe(2500);
    expect(tierFor(1_199_999, tiers).tier.everydayAed).toBe(4000);
    expect(tierFor(1_200_000, tiers).tier).toEqual({ minCollections: 1_200_000, everydayAed: 4750, eliteAed: 13250 });
    expect(tierLabel(0, tiers)).toBe("Under AED 800k");
    expect(tierLabel(3, tiers)).toBe("AED 1.2m and over");
  });

  test("the everyday pool splits 55/45, then by headcount, to the fil", () => {
    const split = splitAllocations(475_000, 55, [
      { key: "sales", group: "revenue", headcount: 31 },
      { key: "cs", group: "revenue", headcount: 12 },
      { key: "mentors", group: "revenue", headcount: 8 },
      { key: "finance", group: "other", headcount: 6 },
      { key: "hr", group: "other", headcount: 9 },
      { key: "media", group: "other", headcount: 9 },
    ]);
    const total = [...split.values()].reduce((s, f) => s + f, 0);
    expect(total).toBe(475_000);
    expect((split.get("sales") ?? 0) + (split.get("cs") ?? 0) + (split.get("mentors") ?? 0)).toBe(261_250);
    expect(split.get("finance")).toBe(53_438);
  });

  test("a group with nobody in it gets nothing", () => {
    const split = splitAllocations(150_000, 55, [{ key: "a", group: "other", headcount: 3 }]);
    expect(split.get("a")).toBe(67_500);
  });

  test("the daily cap: 50 total, 30 automatic, innovation outside it", () => {
    const base = { dailyCap: 50, autoCap: 30, capExempt: false };
    expect(capCheck({ ...base, usedTotal: 30, usedAuto: 30, points: 15, isAuto: false }).ok).toBe(true);
    expect(capCheck({ ...base, usedTotal: 45, usedAuto: 30, points: 30, isAuto: false }).ok).toBe(false);
    expect(capCheck({ ...base, usedTotal: 20, usedAuto: 20, points: 20, isAuto: true }).ok).toBe(false);
    expect(capCheck({ ...base, usedTotal: 50, usedAuto: 30, points: 100, isAuto: false, capExempt: true }).ok).toBe(true);
  });

  test("expiry lands on the same day, or the month's last", () => {
    expect(addMonthsToDay("2026-11-21", 12)).toBe("2027-11-21");
    expect(addMonthsToDay("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDay("2028-02-29", 12)).toBe("2029-02-28");
    expect(previousMonth("2026-01")).toBe("2025-12");
  });
});
