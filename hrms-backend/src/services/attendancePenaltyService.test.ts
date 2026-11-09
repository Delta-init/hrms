import { describe, expect, it } from "bun:test";
import { chargesUnrecorded } from "./attendancePenaltyService.js";

describe("chargesUnrecorded", () => {
  it("charges nothing while the switch is off, whatever the date", () => {
    expect(chargesUnrecorded({ unrecordedDaysUnpaid: false, unrecordedFrom: null }, "2026-11-03")).toBe(false);
    expect(chargesUnrecorded({ unrecordedDaysUnpaid: false, unrecordedFrom: "2026-11-01" }, "2026-11-03")).toBe(false);
  });

  it("charges every day when on with no start date", () => {
    expect(chargesUnrecorded({ unrecordedDaysUnpaid: true, unrecordedFrom: null }, "2026-10-15")).toBe(true);
  });

  it("charges from the start date, not before it", () => {
    const policy = { unrecordedDaysUnpaid: true, unrecordedFrom: "2026-11-01" };
    expect(chargesUnrecorded(policy, "2026-10-31")).toBe(false);
    expect(chargesUnrecorded(policy, "2026-11-01")).toBe(true);
    expect(chargesUnrecorded(policy, "2026-11-03")).toBe(true);
  });
});
