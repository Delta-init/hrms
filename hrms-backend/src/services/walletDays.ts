import type { SummaryTrace } from "./payslipService.js";
import { employedOn, type EmploymentWindow } from "./employmentWindow.js";
import { STANDARD_MONTH_DAYS, dayValue } from "../utils/payMonth.js";

/**
 * The wallet's month, a day at a time (the user, 2026-11-04: "when they came per day it will credit; if they leave or
 * are late it will say you were deducted due to this").
 *
 * Pure: given how the payslip read the month (SummaryTrace) and the attendance times, it credits each day a day of
 * salary and lists what came off it and why. Every rule it applies is the payslip's — a day is a thirtieth of the
 * salary, rest days, holidays and paid leave are paid, a full month is paid in full whatever its length — so the days
 * always add up to the payslip; whatever still differs (HR's own loss-of-pay figure, a salary-sheet import, rounding
 * against a cap) is shown as a line of its own rather than hidden in the days.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

export type WalletDayKind =
  | "on_time" | "late" | "early_out" | "half_day" | "absent" | "wfh"
  | "paid_leave" | "unpaid_leave" | "holiday" | "rest_day"
  | "no_record" | "upcoming" | "not_employed";

export type WalletDeductionKind = "lop" | "late" | "early_out";

export interface WalletDeduction {
  kind: WalletDeductionKind;
  /** Days of pay it costs: 1 or 0.5. */
  days: number;
  amount: number;
  reason: string;
}

export interface WalletDay {
  date: string;
  kind: WalletDayKind;
  label: string;
  checkIn: string | null;
  checkOut: string | null;
  lateMinutes: number;
  workedMinutes: number;
  /** A day of salary — or what is left of the thirty on a month's last days. */
  credit: number;
  /** False for days still to come: shown, but not in the totals yet. */
  counted: boolean;
  deductions: WalletDeduction[];
  note: string | null;
}

export interface WalletReconcile {
  kind: WalletDeductionKind;
  /** Positive takes more off, negative gives back. */
  amount: number;
  reason: string;
}

export interface WalletAttendance {
  date: Date | string;
  timeZone?: string | null;
  status: string;
  checkIn?: Date | string | null;
  checkOut?: Date | string | null;
  lateMinutes?: number | null;
  workedMinutes?: number | null;
}

export interface WalletDaysInput {
  month: string;
  trace: SummaryTrace;
  employment: EmploymentWindow;
  /** 1 unless they joined or left during the month. */
  employedShare: number;
  /** Full monthly salary — what a day is priced against. */
  salary: number;
  /** What the month's salary lines come to: the payslip's, or the prorated gross. Spread over the days. */
  salaryTotal: number;
  attendance: WalletAttendance[];
  /** Count every day, those still to come included — the month has its payslip. */
  wholeMonth: boolean;
  /** HR stopped this month's pay: nothing is credited or taken. */
  muted: boolean;
  /** What the payslip (or its preview) actually takes off, per kind — the days are reconciled to it. */
  actual: Record<WalletDeductionKind, number>;
  lopOverride: { days: number; reason: string; by: string | null } | null;
  /** The payslip came from a salary sheet, not attendance. */
  imported: boolean;
}

export interface WalletDaysResult {
  days: WalletDay[];
  reconcile: WalletReconcile[];
  /** Whether every day of the month is counted — reconciling a month still running would only mislead. */
  complete: boolean;
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

const dayKeyIn = (d: Date | string, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** The month's calendar days as YYYY-MM-DD. */
export function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/**
 * How far into the month's salary each day takes you, 0 to 1.
 *
 * A whole month is paid as thirty days: a day is a thirtieth, the 31st adds nothing and February's last day makes up
 * the missing ones. A part month pays each employed day alike — a thirtieth each, which is what the payslip's prorated
 * salary already is.
 */
function salaryProgress(keys: string[], employed: string[], wholeMonthEmployed: boolean): Map<string, number> {
  const out = new Map<string, number>();
  if (wholeMonthEmployed) {
    keys.forEach((k, i) => out.set(k, i === keys.length - 1 ? 1 : Math.min(i + 1, STANDARD_MONTH_DAYS) / STANDARD_MONTH_DAYS));
  } else {
    employed.forEach((k, i) => out.set(k, (i + 1) / employed.length));
  }
  return out;
}

/** The penalty rule's word on the n-th late arrival (or early leaving) of the month. */
function penaltyStep(n: number, policy: SummaryTrace["policy"], what: "late" | "early_out") {
  const noun = what === "late" ? "late" : "early leaving";
  const plural = what === "late" ? "lates" : "early leavings";
  if (!policy.enabled) return { charge: false, text: `${what === "late" ? "Late" : "Left early"} — no deduction (the late rule is off)` };
  const { graceLates: grace, lateBlockSize: block } = policy;
  if (n <= grace) return { charge: false, text: `${ordinal(n)} ${noun} this month — ${n} of ${grace} free` };
  const over = n - grace;
  if (over % block === 0) {
    return { charge: true, text: `${ordinal(n)} ${noun} this month. ${grace} are free, then every ${block} ${plural} cost half a day` };
  }
  return { charge: false, text: `${ordinal(n)} ${noun} this month — half a day comes off at the ${ordinal(n + (block - (over % block)))}` };
}

export function buildWalletDays(input: WalletDaysInput): WalletDaysResult {
  const { trace: t, month } = input;
  const keys = monthDays(month);
  const employed = keys.filter((k) => employedOn(input.employment, k));
  const progress = salaryProgress(keys, employed, input.employedShare >= 1);
  const counts = (k: string) => input.wholeMonth || k <= t.today;
  const complete = keys.every(counts);

  // The latest record of each day, as the payslip reads them.
  const recordOf = new Map<string, WalletAttendance>();
  for (const a of input.attendance) recordOf.set(dayKeyIn(a.date, a.timeZone || t.tz), a);

  // Lateness and early leaving are counted over the month in date order, every record — as the payslip counts them.
  const nthOf = (status: string) => {
    const order = [...recordOf.entries()].filter(([, a]) => a.status === status).map(([k]) => k).sort();
    return new Map(order.map((k, i) => [k, i + 1]));
  };
  const lateNth = nthOf("late");
  const earlyNth = nthOf("early_out");

  const paidOff = (k: string) => t.paidLeave.has(k) && !t.halfLeaveNoAttendance.has(k);
  const chargeable = (k: string) => t.working.has(k) && !paidOff(k) && !t.holidays.has(k);

  const wholeMonthEmployed = input.employedShare >= 1;
  let previous = 0;
  const days: WalletDay[] = keys.map((k, i) => {
    const rec = recordOf.get(k);
    const counted = counts(k);
    const isEmployed = employed.includes(k);
    const cum = progress.get(k) ?? previous;
    const credit = isEmployed && !input.muted ? r2(r2(input.salaryTotal * cum) - r2(input.salaryTotal * previous)) : 0;
    if (isEmployed) previous = cum;
    const notes: string[] = [];

    const day: WalletDay = {
      date: k, kind: "rest_day", label: "Rest day", checkIn: iso(rec?.checkIn), checkOut: iso(rec?.checkOut),
      lateMinutes: rec?.lateMinutes ?? 0, workedMinutes: rec?.workedMinutes ?? 0,
      credit, counted, deductions: [], note: null,
    };
    if (!isEmployed) {
      return { ...day, kind: "not_employed", label: input.employment.from && k < input.employment.from ? "Before you joined" : "After you left", credit: 0 };
    }
    if (input.muted) notes.push("Pay stopped for this month by HR");
    else if (wholeMonthEmployed && i >= STANDARD_MONTH_DAYS) notes.push(`Day ${i + 1} — a month is paid as ${STANDARD_MONTH_DAYS} days`);
    else if (wholeMonthEmployed && i === keys.length - 1 && keys.length < STANDARD_MONTH_DAYS) {
      notes.push(`Last day — makes the month up to ${STANDARD_MONTH_DAYS} days`);
    }

    // What the day was.
    const leave = t.unpaidLeave.get(k) ?? t.paidLeave.get(k);
    if (rec && !["on_leave", "holiday", "weekend"].includes(rec.status)) {
      const kinds: Record<string, [WalletDayKind, string]> = {
        present: ["on_time", "On time"],
        late: ["late", rec.lateMinutes ? `Late ${rec.lateMinutes} min` : "Late"],
        early_out: ["early_out", "Left early"],
        half_day: ["half_day", "Half day"],
        absent: ["absent", "Absent"],
        wfh: ["wfh", "Work from home"],
      };
      const [kind, label] = kinds[rec.status] ?? ["on_time", rec.status];
      day.kind = kind; day.label = label;
    } else if (t.unpaidLeave.has(k)) {
      day.kind = "unpaid_leave"; day.label = /unpaid/i.test(leave ?? "") ? `${leave}` : `${leave} · unpaid`;
    } else if (t.paidLeave.has(k)) {
      day.kind = "paid_leave"; day.label = `${leave} · paid`;
    } else if (t.holidays.has(k) || rec?.status === "holiday") {
      day.kind = "holiday"; day.label = "Public holiday · paid";
    } else if (!t.working.has(k) || rec?.status === "weekend") {
      day.kind = "rest_day"; day.label = "Rest day · paid";
    } else if (k >= t.today && !input.wholeMonth) {
      day.kind = "upcoming"; day.label = k === t.today ? "Today" : "Still to come";
    } else {
      day.kind = "no_record"; day.label = "No attendance recorded";
    }

    // What came off it, and why — the payslip's own rules, in its order.
    const off: WalletDeduction[] = [];
    const take = (kind: WalletDeductionKind, days: number, reason: string) => off.push({ kind, days, amount: 0, reason });
    if (!input.muted) {
      if (chargeable(k) && t.unpaidLeave.has(k)) {
        const name = t.unpaidLeave.get(k) ?? "Leave";
        take("lop", 1, /unpaid/i.test(name) ? `${name} — the day isn't paid` : `${name} — unpaid leave, the day isn't paid`);
      }
      else if (chargeable(k) && t.absent.has(k)) take("lop", 1, "Absent — no check-in and no approved leave");
      else if (chargeable(k) && t.half.has(k)) take("lop", 0.5, "Half day — the other half is unpaid");
      if (t.halfLeaveNoAttendance.has(k) && t.working.has(k) && !t.holidays.has(k)) {
        take("lop", 0.5, `Half-day ${leave ?? "leave"}, but nothing worked the other half`);
      }
      if (t.unrecorded.includes(k) && k < t.today) {
        if (t.policy.unrecordedDaysUnpaid) take("lop", 1, "No attendance and no leave recorded");
        else notes.push("Nothing recorded — not charged");
      }
      for (const [what, nth] of [["late", lateNth.get(k)], ["early_out", earlyNth.get(k)]] as const) {
        if (!nth) continue;
        const step = penaltyStep(nth, t.policy, what);
        if (step.charge) take(what, 0.5, step.text);
        else notes.push(step.text);
      }
      if (t.exempt && off.length) notes.push("Attendance-exempt — nothing deducted");
      else day.deductions = off;
    }
    day.note = notes.length ? notes.join(" · ") : null;
    return day;
  });

  // Priced the payslip's way: a thirtieth of the salary per day, rounded on the running total so the days add up to
  // exactly what the payslip charges for the same count.
  const perDay = dayValue(input.salary);
  for (const kind of ["lop", "late", "early_out"] as const) {
    let run = 0;
    for (const d of days) for (const x of d.deductions) {
      if (x.kind !== kind) continue;
      x.amount = r2(r2(perDay * (run + x.days)) - r2(perDay * run));
      run += x.days;
    }
  }

  const reconcile: WalletReconcile[] = [];
  const counted = (kind: WalletDeductionKind) =>
    r2(days.filter((d) => d.counted).flatMap((d) => d.deductions).filter((x) => x.kind === kind).reduce((s, x) => s + x.amount, 0));
  for (const kind of ["lop", "late", "early_out"] as const) {
    // A running month is reconciled only for HR's own figure, which is a decision, not a projection.
    if (!complete && !(kind === "lop" && input.lopOverride)) continue;
    const diff = r2((input.actual[kind] ?? 0) - counted(kind));
    if (Math.abs(diff) < 0.01) continue;
    const o = input.lopOverride;
    reconcile.push({
      kind,
      amount: diff,
      reason: kind === "lop" && o
        ? `HR set loss of pay to ${o.days} day${o.days === 1 ? "" : "s"}${o.reason ? `: ${o.reason}` : ""}${o.by ? ` (${o.by})` : ""}`
        : input.imported ? "As on your payslip, from the salary sheet"
        : "Adjusted to match your payslip",
    });
  }

  return { days, reconcile, complete };
}
