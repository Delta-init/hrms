import { describe, expect, it } from "bun:test";
import {
  addMonths, monthOfWeek, isDayKey, isMonday, lastCompletedWeek, missingWeeks, mondayOf, monthsBetween,
  platformKey, round2, sourceIsPlatform, tidyLines, weekEnd, weekTotal, weeksBetween,
} from "./adSpend.js";

describe("weeks", () => {
  it("finds the Monday of any day, Sunday included", () => {
    expect(mondayOf("2026-11-13")).toBe("2026-11-09"); // Friday
    expect(mondayOf("2026-11-09")).toBe("2026-11-09"); // Monday
    expect(mondayOf("2026-11-15")).toBe("2026-11-09"); // Sunday belongs to the week before it
    expect(mondayOf("2026-01-01")).toBe("2025-12-29"); // across a year
  });

  it("knows a Monday and a real date", () => {
    expect(isMonday("2026-11-02")).toBe(true);
    expect(isMonday("2026-11-03")).toBe(false);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("10/05/2026")).toBe(false);
  });

  it("ends a week on the Sunday and lists Mondays", () => {
    expect(weekEnd("2026-11-02")).toBe("2026-11-08");
    expect(weeksBetween("2026-10-19", "2026-11-02")).toEqual(["2026-10-19", "2026-10-26", "2026-11-02"]);
  });

  it("takes last week as the one that has finished", () => {
    expect(lastCompletedWeek("2026-11-09")).toBe("2026-11-02"); // on the Monday itself
    expect(lastCompletedWeek("2026-11-15")).toBe("2026-11-02"); // still that week until Sunday is over
  });
});

describe("missingWeeks", () => {
  it("lists finished weeks nobody logged, from when counting started", () => {
    expect(missingWeeks("2026-10-19", "2026-11-11", ["2026-10-26"])).toEqual(["2026-10-19", "2026-11-02"]);
  });

  it("never counts the week under way, or anything before the start", () => {
    expect(missingWeeks("2026-11-09", "2026-11-13", [])).toEqual([]);
    expect(missingWeeks("2026-11-02", "2026-11-09", ["2026-11-02"])).toEqual([]);
  });

  it("is nothing until a start is set", () => {
    expect(missingWeeks(null, "2026-11-13", [])).toEqual([]);
  });
});

describe("months", () => {
  it("counts a week in the month holding most of its days", () => {
    expect(monthOfWeek("2026-06-29")).toBe("2026-07"); // 29 Jun – 5 Jul
    expect(monthOfWeek("2026-10-26")).toBe("2026-10"); // 26 Oct – 1 Nov
    expect(monthOfWeek("2026-11-30")).toBe("2026-12"); // 30 Nov – 6 Dec
  });

  it("runs across a year end", () => {
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(addMonths("2026-11", -5)).toBe("2026-06");
    expect(addMonths("2026-11", 2)).toBe("2027-01");
  });
});

describe("money", () => {
  it("rounds without float residue", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(208.315)).toBe(208.32);
  });

  it("adds every platform of every role", () => {
    expect(weekTotal([
      { role: "A", amounts: [{ platform: "linkedin", amount: 190 }, { platform: "indeed", amount: 52.41 }] },
      { role: "B", amounts: [{ platform: "meta", amount: 57.69 }] },
    ])).toBe(300.1);
  });
});

describe("tidyLines", () => {
  it("folds the same role into one line and drops empty cells", () => {
    const out = tidyLines([
      { role: "Forex Mentor ", requisition: null, amounts: [{ platform: "linkedin", amount: 100 }, { platform: "meta", amount: 0 }], note: "first post" },
      { role: "forex  mentor", requisition: null, amounts: [{ platform: "linkedin", amount: 50.5 }, { platform: "indeed", amount: 20 }], note: "reposted" },
      { role: "Nothing", requisition: null, amounts: [{ platform: "linkedin", amount: 0 }] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("Forex Mentor");
    expect(out[0].amounts).toEqual([{ platform: "linkedin", amount: 150.5 }, { platform: "indeed", amount: 20 }]);
    expect(out[0].note).toBe("first post; reposted");
  });

  it("keeps two roles of the same name apart when they are different requests", () => {
    const out = tidyLines([
      { role: "Sales", requisition: "a", amounts: [{ platform: "indeed", amount: 10 }] },
      { role: "Sales", requisition: "b", amounts: [{ platform: "indeed", amount: 10 }] },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("platforms", () => {
  it("makes a key from a name", () => {
    expect(platformKey("Bayt.com")).toBe("bayt-com");
    expect(platformKey("  LinkedIn ")).toBe("linkedin");
  });

  it("recognises a candidate's source, typed or picked", () => {
    const meta = { key: "meta", label: "Meta" };
    expect(sourceIsPlatform("Meta", meta)).toBe(true);
    expect(sourceIsPlatform("Meta Ads", meta)).toBe(true);
    expect(sourceIsPlatform("Ads", meta)).toBe(false);
    expect(sourceIsPlatform("", meta)).toBe(false);
    expect(sourceIsPlatform("linkedin jobs", { key: "linkedin", label: "LinkedIn" })).toBe(true);
  });
});
