import { describe, expect, it } from "bun:test";
import { addSpan, applyBeat, coveredSeconds, firstGap, furthestReached, playedSpan, watchProgress } from "./watchSpans.js";

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

describe("applyBeat and watchProgress", () => {
  const fresh = { spans: [], lastPosition: 0, lastBeatAt: new Date(0), watchedSeconds: 0, skipAttempts: 0, completedAt: null };
  const at = (s: number) => new Date(s * 1000);

  it("covers what the clock allows and completes at the end", () => {
    let s = applyBeat(fresh, 10, 20, at(10));
    expect(s.watchedSeconds).toBe(10);
    expect(watchProgress(s, 20)).toEqual({ percent: 50, furthest: 10, resumeAt: 10, reachedEnd: false, completed: false });
    s = applyBeat(s, 20, 20, at(20));
    expect(s.completedAt).toEqual(at(20));
    expect(watchProgress(s, 20).percent).toBe(100);
  });

  it("counts a jump as a skip and covers only the time that passed", () => {
    const s = applyBeat(fresh, 18, 20, at(2));
    expect(s.skipAttempts).toBe(1);
    expect(s.watchedSeconds).toBeCloseTo(3.5);
    expect(s.completedAt).toBeNull();
    expect(watchProgress(s, 20).resumeAt).toBe(0);
  });

  it("does not move once complete", () => {
    const done = { ...fresh, completedAt: at(5) };
    expect(applyBeat(done, 3, 20, at(9))).toBe(done);
  });
});
