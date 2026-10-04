import { describe, expect, it } from "bun:test";
import { scheduleOf, leavesIn } from "./workHours.js";

describe("scheduleOf", () => {
  it("is the default the HRMS goes by when nobody assigned one, and says so", () => {
    expect(scheduleOf(null)).toEqual({
      name: "Default", timeZone: "Asia/Dubai", loginTime: "09:00", logoutTime: "18:00",
      workDays: [1, 2, 3, 4, 5, 6], halfDays: [], mode: "fixed", requiredHours: null, assigned: false,
    });
  });

  it("is the assigned schedule as it stands", () => {
    const s = scheduleOf({ name: "Evening mentors", timeZone: "Asia/Kolkata", loginTime: "16:00", logoutTime: "23:00", workDays: [0, 1, 2, 3, 4, 5], halfDays: [5] });
    expect(s).toEqual({
      name: "Evening mentors", timeZone: "Asia/Kolkata", loginTime: "16:00", logoutTime: "23:00",
      workDays: [0, 1, 2, 3, 4, 5], halfDays: [5], mode: "fixed", requiredHours: null, assigned: true,
    });
  });

  it("keeps the hours a duration schedule asks for", () => {
    expect(scheduleOf({ name: "Flexible", mode: "duration", requiredHours: 6 }).requiredHours).toBe(6);
  });
});

describe("leavesIn", () => {
  // A Dubai day stored as its local midnight in UTC: the 8th is 20:00Z on the 7th.
  const dubai = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() - 4 * 3_600_000);

  it("reads each leave's days in its own time zone", () => {
    expect(leavesIn([{ type: "casual", startDate: dubai("2026-10-08"), endDate: dubai("2026-10-09"), timeZone: "Asia/Dubai" }], "2026-10-04", "2026-10-10"))
      .toEqual([{ type: "casual", from: "2026-10-08", to: "2026-10-09", halfDay: false }]);
  });

  it("keeps only leave touching the window, earliest first, half days said", () => {
    const got = leavesIn([
      { type: "sick", startDate: dubai("2026-10-10"), endDate: dubai("2026-10-12"), timeZone: "Asia/Dubai" },
      { type: "annual", startDate: dubai("2026-09-20"), endDate: dubai("2026-09-25"), timeZone: "Asia/Dubai" },
      { type: "casual", startDate: dubai("2026-10-04"), endDate: dubai("2026-10-04"), halfDay: true, timeZone: "Asia/Dubai" },
      { type: "casual", startDate: new Date("2026-10-11T00:00:00Z"), endDate: new Date("2026-10-11T00:00:00Z"), timeZone: "Asia/Kolkata" },
    ], "2026-10-04", "2026-10-10");
    expect(got).toEqual([
      { type: "casual", from: "2026-10-04", to: "2026-10-04", halfDay: true },
      { type: "sick", from: "2026-10-10", to: "2026-10-12", halfDay: false },
    ]);
  });
});
