import { describe, expect, it } from "bun:test";
import { addSpan, coveredSeconds, firstGap, furthestReached, playedSpan } from "./watchSpans.js";

describe("addSpan", () => {
  it("merges overlapping and touching stretches, in order", () => {
    let spans = addSpan([], 40, 60);
    spans = addSpan(spans, 0, 20);
    spans = addSpan(spans, 20, 30);
    spans = addSpan(spans, 55, 70);
    expect(spans).toEqual([{ from: 0, to: 30 }, { from: 40, to: 70 }]);
  });

  it("ignores an empty stretch and leaves the original alone", () => {
    const spans = [{ from: 0, to: 10 }];
    expect(addSpan(spans, 5, 5)).toEqual([{ from: 0, to: 10 }]);
    addSpan(spans, 10, 20);
    expect(spans).toEqual([{ from: 0, to: 10 }]);
  });
});

describe("coveredSeconds and furthestReached", () => {
  it("counts a part watched twice once", () => {
    let spans = addSpan([], 0, 60);
    spans = addSpan(spans, 20, 60);
    expect(coveredSeconds(spans)).toBe(60);
    expect(furthestReached(spans)).toBe(60);
  });

  it("is nothing for nothing watched", () => {
    expect(coveredSeconds([])).toBe(0);
    expect(furthestReached([])).toBe(0);
  });
});

describe("firstGap", () => {
  it("finds the part a jump left behind", () => {
    expect(firstGap([{ from: 0, to: 30 }, { from: 90, to: 100 }], 100, 1)).toBe(30);
  });

  it("is null when everything up to the point is covered", () => {
    expect(firstGap([{ from: 0, to: 80 }], 80, 1)).toBeNull();
  });

  it("ignores gaps no longer than the minimum, unless asked not to", () => {
    const spans = [{ from: 0, to: 50 }, { from: 50.6, to: 140 }];
    expect(firstGap(spans, 140, 1)).toBeNull();
    expect(firstGap(spans, 140)).toBe(50);
  });

  it("finds a start they never saw", () => {
    expect(firstGap([{ from: 10, to: 40 }], 40, 1)).toBe(0);
  });
});

describe("playedSpan", () => {
  it("covers the whole move when the clock accounts for it", () => {
    expect(playedSpan(10, 15, 5, 1.5)).toEqual({ from: 10, to: 15, outran: false });
  });

  it("covers only the seconds before the landing when it jumped", () => {
    expect(playedSpan(10, 100, 5, 1.5)).toEqual({ from: 93.5, to: 100, outran: true });
  });

  it("covers nothing going backwards or standing still", () => {
    expect(playedSpan(50, 20, 5, 1.5)).toBeNull();
    expect(playedSpan(50, 50, 5, 1.5)).toBeNull();
  });
});
