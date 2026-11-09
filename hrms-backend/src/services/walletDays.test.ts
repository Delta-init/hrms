import { describe, expect, it } from "bun:test";
import { buildWalletDays, monthDays, type WalletDaysInput } from "./walletDays.js";
import type { SummaryTrace } from "./payslipService.js";

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
const POLICY = { enabled: true, graceLates: 3, lateBlockSize: 3, unrecordedDaysUnpaid: false, unrecordedFrom: null as string | null, defaultRegularizationStatus: "present" as const, monthlyRegularizationLimit: 3 };

/** A month with Sundays off and the rest working days. */
function trace(month: string, over: Partial<SummaryTrace> = {}): SummaryTrace {
  const working = new Set(monthDays(month).filter((k) => new Date(`${k}T00:00:00Z`).getUTCDay() !== 0));
  return {
    tz: "Asia/Dubai", start: new Date(`${month}-01T00:00:00Z`), end: new Date(`${month}-28T00:00:00Z`), today: "2099-01-01",
    working, holidays: new Set(), paidLeave: new Map(), unpaidLeave: new Map(), absent: new Set(), half: new Set(),
    halfLeaveNoAttendance: new Set(), unrecorded: [], policy: POLICY, exempt: false, ...over,
  };
}

const at = (day: string, status: string, extra: Record<string, unknown> = {}) => ({
  date: `${day}T00:00:00+04:00`, timeZone: "Asia/Dubai", status, checkIn: `${day}T09:00:00+04:00`, checkOut: `${day}T18:00:00+04:00`, ...extra,
});

function input(over: Partial<WalletDaysInput> & { month: string }): WalletDaysInput {
  return {
    trace: trace(over.month), employment: { from: null, to: null }, employedShare: 1, salary: 6000, salaryTotal: 6000,
    attendance: [], wholeMonth: true, muted: false, actual: { lop: 0, late: 0, early_out: 0 }, lopOverride: null, imported: false,
    ...over,
  };
}

describe("salary credits", () => {
  it("pays a day as a thirtieth, and the 31st adds nothing", () => {
    const { days } = buildWalletDays(input({ month: "2026-10" }));
    expect(days).toHaveLength(31);
    expect(days.slice(0, 30).every((d) => d.credit === 200)).toBe(true);
    expect(days[30]!.credit).toBe(0);
    expect(days[30]!.note).toBe("Day 31 — a month is paid as 30 days");
    expect(sum(days.map((d) => d.credit))).toBe(6000);
  });

  it("makes February up to thirty days on its last day", () => {
    const { days } = buildWalletDays(input({ month: "2026-02" }));
    expect(days[26]!.credit).toBe(200);
    expect(days[27]!.credit).toBe(600);
    expect(sum(days.map((d) => d.credit))).toBe(6000);
  });

  it("adds up to an awkward salary to the fils", () => {
    const { days } = buildWalletDays(input({ month: "2026-10", salary: 4999.99, salaryTotal: 4999.99 }));
    expect(sum(days.map((d) => d.credit))).toBe(4999.99);
  });

  it("pays a joiner's employed days only, a thirtieth each", () => {
    const { days } = buildWalletDays(input({ month: "2026-10", employment: { from: "2026-10-20", to: null }, employedShare: 12 / 30, salaryTotal: 2400 }));
    expect(days[18]!.kind).toBe("not_employed");
    expect(days[18]!.label).toBe("Before you joined");
    expect(days[18]!.credit).toBe(0);
    expect(days.slice(19).every((d) => d.credit === 200)).toBe(true);
    expect(sum(days.map((d) => d.credit))).toBe(2400);
  });

  it("credits nothing when HR stopped the month's pay", () => {
    const { days } = buildWalletDays(input({ month: "2026-10", muted: true }));
    expect(sum(days.map((d) => d.credit))).toBe(0);
  });

  it("counts a running month only up to today", () => {
    const t = trace("2026-11", { today: "2026-11-04" });
    const { days, complete } = buildWalletDays(input({ month: "2026-11", trace: t, wholeMonth: false }));
    expect(complete).toBe(false);
    expect(days.filter((d) => d.counted).map((d) => d.date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(days[3]!.label).toBe("Today");
    expect(days[10]!.label).toBe("Still to come");
  });
});

describe("deductions, each with its reason", () => {
  // Tue 6, Wed 7 … the 6th late lands on a working day.
  const lates = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"];
  const t = trace("2026-10", {
    absent: new Set(["2026-10-13"]), half: new Set(["2026-10-14"]),
    unpaidLeave: new Map([["2026-10-15", "Unpaid leave"]]),
    paidLeave: new Map([["2026-10-20", "Annual leave"]]),
    holidays: new Set(["2026-10-21"]),
  });
  const attendance = [
    ...lates.map((d, i) => at(d, "late", { lateMinutes: 10 + i })),
    at("2026-10-13", "absent", { checkIn: null, checkOut: null }), at("2026-10-14", "half_day"), at("2026-10-16", "present"),
  ];
  const built = buildWalletDays(input({ month: "2026-10", trace: t, attendance, actual: { lop: 500, late: 100, early_out: 0 } }));
  const day = (d: string) => built.days.find((x) => x.date === d)!;

  it("reads what each day was", () => {
    expect(day("2026-10-16").label).toBe("On time");
    expect(day("2026-10-09").label).toBe("Late 16 min");
    expect(day("2026-10-15").label).toBe("Unpaid leave");
    expect(day("2026-10-20").label).toBe("Annual leave · paid");
    expect(day("2026-10-21").label).toBe("Public holiday · paid");
    expect(day("2026-10-04").label).toBe("Rest day · paid");
  });

  it("takes a day for absence and unpaid leave, half for a half day", () => {
    expect(day("2026-10-13").deductions).toEqual([{ kind: "lop", days: 1, amount: 200, reason: "Absent — no check-in and no approved leave" }]);
    expect(day("2026-10-15").deductions[0]!.reason).toBe("Unpaid leave — the day isn't paid");
    expect(day("2026-10-14").deductions).toEqual([{ kind: "lop", days: 0.5, amount: 100, reason: "Half day — the other half is unpaid" }]);
    expect(day("2026-10-20").deductions).toEqual([]);
  });

  it("lets three lates go, then takes half a day at every third after", () => {
    expect(day("2026-10-02").note).toBe("2nd late this month — 2 of 3 free");
    expect(day("2026-10-06").note).toBe("4th late this month — half a day comes off at the 6th");
    expect(day("2026-10-08").deductions).toEqual([
      { kind: "late", days: 0.5, amount: 100, reason: "6th late this month. 3 are free, then every 3 lates cost half a day" },
    ]);
    expect(day("2026-10-09").deductions).toEqual([]);
  });

  it("adds up to the payslip, so nothing needs reconciling", () => {
    expect(built.reconcile).toEqual([]);
  });

  it("shows HR's own loss-of-pay figure as a line of its own", () => {
    const o = buildWalletDays(input({
      month: "2026-10", trace: t, attendance, actual: { lop: 200, late: 100, early_out: 0 },
      lopOverride: { days: 1, reason: "Forgot to punch", by: "HR" },
    }));
    expect(o.reconcile).toEqual([{ kind: "lop", amount: -300, reason: "HR set loss of pay to 1 day: Forgot to punch (HR)" }]);
  });

  it("charges nothing for an attendance-exempt employee, and says why", () => {
    const e = buildWalletDays(input({ month: "2026-10", trace: { ...t, exempt: true }, attendance }));
    expect(e.days.flatMap((d) => d.deductions)).toEqual([]);
    expect(e.days.find((d) => d.date === "2026-10-13")!.note).toBe("Attendance-exempt — nothing deducted");
  });

  it("says the late rule is off when it is", () => {
    const off = buildWalletDays(input({ month: "2026-10", trace: { ...t, policy: { ...POLICY, enabled: false } }, attendance }));
    expect(off.days.find((d) => d.date === "2026-10-08")!.deductions).toEqual([]);
    expect(off.days.find((d) => d.date === "2026-10-08")!.note).toBe("Late — no deduction (the late rule is off)");
  });
});

describe("days with nothing recorded", () => {
  const t = trace("2026-11", { today: "2026-11-10", unrecorded: ["2026-11-03", "2026-11-12"] });

  it("are not charged unless the organization made attendance mandatory", () => {
    const { days } = buildWalletDays(input({ month: "2026-11", trace: t, wholeMonth: false }));
    expect(days[2]!.label).toBe("No attendance recorded");
    expect(days[2]!.note).toBe("Nothing recorded — not charged");
    expect(days[2]!.deductions).toEqual([]);
  });

  it("are charged when it did, but only once the day is over", () => {
    const { days } = buildWalletDays(input({ month: "2026-11", trace: { ...t, policy: { ...POLICY, unrecordedDaysUnpaid: true } }, wholeMonth: false }));
    expect(days[2]!.deductions[0]!.reason).toBe("No attendance and no leave recorded");
    expect(days[11]!.deductions).toEqual([]);
  });

  it("are charged only from the day it counts from", () => {
    const from = trace("2026-11", { today: "2026-11-10", unrecorded: ["2026-11-03", "2026-11-05"], policy: { ...POLICY, unrecordedDaysUnpaid: true, unrecordedFrom: "2026-11-04" } });
    const { days } = buildWalletDays(input({ month: "2026-11", trace: from, wholeMonth: false }));
    expect(days[2]!.deductions).toEqual([]);
    expect(days[2]!.note).toBe("Nothing recorded — not charged");
    expect(days[4]!.deductions[0]!.reason).toBe("No attendance and no leave recorded");
  });
});
