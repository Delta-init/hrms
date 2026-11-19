import { describe, expect, it } from "bun:test";
import { addMonths, project, takeFor } from "./loanSchedule.js";

describe("takeFor", () => {
  it("takes one instalment, or the remainder at the end", () => {
    expect(takeFor(4000, 500)).toBe(500);
    expect(takeFor(250, 500)).toBe(250);
    expect(takeFor(333.34, 333.33)).toBe(333.34); // the last third takes the cent too
    expect(takeFor(0, 500)).toBe(0);
  });

  it("takes nothing in a skipped month, and the planned amount in a smaller one", () => {
    expect(takeFor(4000, 500, 0)).toBe(0);
    expect(takeFor(4000, 500, 250)).toBe(250);
    expect(takeFor(100, 500, 250)).toBe(100); // never more than is owed
  });
});

describe("addMonths", () => {
  it("rolls over the year", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
  });
});

describe("project", () => {
  it("runs the plain schedule out", () => {
    expect(project(1500, 500, "2027-01", new Map()).map((p) => [p.month, p.take])).toEqual([
      ["2027-01", 500], ["2027-02", 500], ["2027-03", 500],
    ]);
  });

  it("ends a month later for a skip, and adds a smaller month's shortfall to the end", () => {
    const plans = new Map([["2027-01", 0], ["2027-02", 250]]);
    expect(project(1500, 500, "2027-01", plans).map((p) => [p.month, p.take, p.plan])).toEqual([
      ["2027-01", 0, "skip"],
      ["2027-02", 250, "partial"],
      ["2027-03", 500, null],
      ["2027-04", 500, null],
      ["2027-05", 250, null],
    ]);
  });

  it("finishes sooner once part is paid directly — same monthly amount", () => {
    expect(project(1500 - 1000, 500, "2027-01", new Map()).map((p) => [p.month, p.take])).toEqual([["2027-01", 500]]);
  });

  it("is nothing once nothing is owed, and never runs forever", () => {
    expect(project(0, 500, "2027-01", new Map())).toEqual([]);
    expect(project(100, 0, "2027-01", new Map())).toEqual([{ month: "2027-01", take: 0, plan: null }]);
  });
});
