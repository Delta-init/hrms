import { describe, expect, it } from "bun:test";
import { addDays, dayNumber, isChatGptShareLink, joiningDayKey, lastRedDay, workingDayKeys } from "./firstDays.js";

const MON_SAT = [1, 2, 3, 4, 5, 6];

describe("joiningDayKey", () => {
  it("is the day the date was picked for, stored as UTC midnight or as a local midnight either side", () => {
    expect(joiningDayKey("2026-11-09T00:00:00.000Z")).toBe("2026-11-09");
    expect(joiningDayKey("2026-11-08T20:00:00.000Z")).toBe("2026-11-09"); // Dubai midnight
    expect(joiningDayKey("2026-11-08T18:30:00.000Z")).toBe("2026-11-09"); // India midnight
  });
});

describe("dayNumber and lastRedDay", () => {
  it("counts the joining day as day 1 and ends red on day 15", () => {
    expect(dayNumber("2026-11-09", "2026-11-09")).toBe(1);
    expect(dayNumber("2026-11-09", "2026-11-23")).toBe(15);
    expect(dayNumber("2026-11-09", "2026-11-24")).toBe(16);
    expect(dayNumber("2026-11-09", "2026-11-08")).toBe(0);
    expect(lastRedDay("2026-11-09")).toBe("2026-11-23");
  });

  it("crosses a month end", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(lastRedDay("2026-12-25")).toBe("2027-01-08");
  });
});

describe("workingDayKeys", () => {
  it("is the joining day, then the next days they work", () => {
    // Mon 9 Nov → Tue 10, Wed 11
    expect(workingDayKeys("2026-11-09", 3, MON_SAT, new Set())).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
  });

  it("skips their day off", () => {
    // Sat 14 Nov; Sunday is off → Mon 16, Tue 17
    expect(workingDayKeys("2026-11-14", 3, MON_SAT, new Set())).toEqual(["2026-11-14", "2026-11-16", "2026-11-17"]);
  });

  it("skips a holiday", () => {
    expect(workingDayKeys("2026-11-09", 3, MON_SAT, new Set(["2026-11-10"]))).toEqual(["2026-11-09", "2026-11-11", "2026-11-12"]);
  });

  it("counts day 1 even on a day they would not normally work", () => {
    expect(workingDayKeys("2026-11-15", 2, MON_SAT, new Set())).toEqual(["2026-11-15", "2026-11-16"]);
  });

  it("gives up rather than loop on a schedule with no working days", () => {
    expect(workingDayKeys("2026-11-09", 3, [], new Set())).toEqual(["2026-11-09"]);
  });
});

describe("isChatGptShareLink", () => {
  it("takes a shared ChatGPT conversation", () => {
    expect(isChatGptShareLink("https://chatgpt.com/share/6731a9c2-1b2c-8000-9f3e-0a1b2c3d4e5f")).toBe(true);
    expect(isChatGptShareLink(" https://chat.openai.com/share/abc-123 ")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isChatGptShareLink("https://chatgpt.com/")).toBe(false);
    expect(isChatGptShareLink("https://chatgpt.com/c/6731a9c2")).toBe(false);
    expect(isChatGptShareLink("http://chatgpt.com/share/abc")).toBe(false);
    expect(isChatGptShareLink("https://evil.example/share/abc")).toBe(false);
    expect(isChatGptShareLink("not a link")).toBe(false);
  });
});
