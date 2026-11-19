import { describe, expect, it } from "bun:test";
import { dayOfRecord, laterRecord, onePerDay } from "./attendanceDay.js";

// Abshar p, 4 November 2026: the punch filed under Kolkata, the correction under Dubai.
const punch = {
  _id: "a", status: "half_day", date: new Date("2026-11-03T18:30:00Z"), timeZone: "Asia/Kolkata", localDay: "2026-11-04",
  createdAt: new Date("2026-11-04T09:15:00Z"), updatedAt: new Date("2026-11-04T09:15:00Z"),
};
const correction = {
  _id: "b", status: "present", date: new Date("2026-11-03T20:00:00Z"), timeZone: "Asia/Dubai", localDay: "2026-11-04",
  createdAt: new Date("2026-11-09T07:41:00Z"), updatedAt: new Date("2026-11-09T07:41:00Z"),
};
const nextDay = {
  _id: "c", status: "present", date: new Date("2026-11-04T20:00:00Z"), timeZone: "Asia/Dubai", localDay: "2026-11-05",
  createdAt: new Date("2026-11-09T07:41:00Z"), updatedAt: new Date("2026-11-09T07:41:00Z"),
};

describe("dayOfRecord", () => {
  it("reads both filings of one day as that day", () => {
    expect(dayOfRecord(punch)).toBe("2026-11-04");
    expect(dayOfRecord(correction)).toBe("2026-11-04");
  });

  it("works the day out from the record's own zone when it has none stored", () => {
    expect(dayOfRecord({ date: new Date("2026-11-03T18:30:00Z"), timeZone: "Asia/Kolkata" })).toBe("2026-11-04");
    expect(dayOfRecord({ date: new Date("2026-11-03T20:00:00Z"), timeZone: "Asia/Dubai" })).toBe("2026-11-04");
  });
});

describe("onePerDay", () => {
  it("keeps the correction, not the punch it corrected — whichever order they come in", () => {
    expect(onePerDay([punch, correction, nextDay]).map((r) => r._id)).toEqual(["b", "c"]);
    expect(onePerDay([correction, nextDay, punch]).map((r) => r._id)).toEqual(["b", "c"]);
  });

  it("keeps the one changed last, even when it was made first", () => {
    // Vishnu Suresh, 1 September: the Dubai record was made first but corrected last.
    const madeFirst = { ...correction, createdAt: new Date("2026-09-01T09:02:00Z"), updatedAt: new Date("2026-09-29T09:06:00Z") };
    const madeLater = { ...punch, createdAt: new Date("2026-09-01T16:20:00Z"), updatedAt: new Date("2026-09-01T16:20:00Z") };
    expect(laterRecord(madeFirst, madeLater)._id).toBe("b");
  });

  it("leaves a single record a day alone", () => {
    expect(onePerDay([nextDay])).toEqual([nextDay]);
    expect(onePerDay([])).toEqual([]);
  });
});
