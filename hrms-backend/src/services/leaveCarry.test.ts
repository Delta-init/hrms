import { describe, expect, it } from "bun:test";
import { carriesIntoNextMonth, carryOver } from "./leavePolicyResolver.js";

describe("carriesIntoNextMonth", () => {
  it("is remote staff's monthly casual leave, and nothing else", () => {
    expect(carriesIntoNextMonth({ type: "casual", period: "month", workMode: "wfh" })).toBe(true);
    expect(carriesIntoNextMonth({ type: "casual", period: "month", workMode: "office" })).toBe(false);
    expect(carriesIntoNextMonth({ type: "casual", period: "month", workMode: null })).toBe(false);
    expect(carriesIntoNextMonth({ type: "sick", period: "month", workMode: "wfh" })).toBe(false);
    expect(carriesIntoNextMonth({ type: "casual", period: "year", workMode: "wfh" })).toBe(false);
  });
});

describe("carryOver — 1 day a month", () => {
  it("carries a day nobody took", () => {
    expect(carryOver(1, 0, 0, 1)).toBe(1);
  });

  it("carries nothing once the month's day was taken", () => {
    expect(carryOver(1, 1, 0, 1)).toBe(0);
  });

  it("uses the carried day first, so this month's own day carries on", () => {
    // October's day carried into November; one day taken in November.
    expect(carryOver(1, 1, 1, 1)).toBe(1);
  });

  it("never builds up past one month's allowance", () => {
    // Nothing taken in a month that had a day carried in: still only 1 goes on.
    expect(carryOver(1, 0, 1, 1)).toBe(1);
  });

  it("carries nothing when both days were taken", () => {
    expect(carryOver(1, 2, 1, 1)).toBe(0);
  });

  it("carries half a day after a half-day off", () => {
    expect(carryOver(1, 0.5, 0, 1)).toBe(0.5);
  });

  it("carries nothing for a month they weren't eligible in", () => {
    expect(carryOver(0, 0, 0, 1)).toBe(0);
  });
});
