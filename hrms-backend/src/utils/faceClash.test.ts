import { describe, expect, it } from "bun:test";
import { judgeClash, selfSimilarity } from "./faceClash.js";

const kiosk = { threshold: 0.45, margin: 0.05, band: 0.1 };

describe("judgeClash", () => {
  it("lets through somebody nowhere near anybody", () => {
    expect(judgeClash({ ...kiosk, clash: 0.1, self: 0.9 })).toBe("clear");
  });

  it("enrols a look-alike who matches themselves far better (the Althaf case)", () => {
    expect(judgeClash({ ...kiosk, clash: 0.38, self: 0.9 })).toBe("separable");
  });

  it("enrols even above the threshold when the gap is wide — the kiosk will pick them over the other", () => {
    expect(judgeClash({ ...kiosk, clash: 0.5, self: 0.92 })).toBe("separable");
  });

  it("refuses the same face on a second account", () => {
    expect(judgeClash({ ...kiosk, clash: 0.82, self: 0.9 })).toBe("same_person");
  });

  it("refuses twins the kiosk could not separate", () => {
    expect(judgeClash({ ...kiosk, clash: 0.4, self: 0.55 })).toBe("too_similar");
  });

  it("judges the gap against the kiosk margin plus room for a different day", () => {
    expect(judgeClash({ ...kiosk, clash: 0.4, self: 0.6 })).toBe("separable"); // gap 0.20
    expect(judgeClash({ ...kiosk, clash: 0.4, self: 0.59 })).toBe("too_similar"); // gap 0.19
  });

  it("falls back to the old answer with nothing to compare against", () => {
    expect(judgeClash({ ...kiosk, clash: 0.4, self: null })).toBe("too_similar");
    expect(judgeClash({ ...kiosk, clash: 0.5, self: null })).toBe("same_person");
  });
});

describe("selfSimilarity", () => {
  it("is the worst pair among the captures", () => {
    const a = [1, 0, 0];
    const b = [0.8, 0.6, 0];
    const c = [0.6, 0.8, 0];
    expect(selfSimilarity([a, b, c])).toBeCloseTo(0.6);
  });

  it("does not depend on vector length", () => {
    expect(selfSimilarity([[2, 0], [0.5, 0]])).toBeCloseTo(1);
  });

  it("is null for a single capture", () => {
    expect(selfSimilarity([[1, 0]])).toBeNull();
  });
});
