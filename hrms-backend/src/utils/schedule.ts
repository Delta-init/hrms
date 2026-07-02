/**
 * Timezone-aware shift resolution for attendance clock-in/out.
 * No external tz library — uses Intl to compute the zone offset.
 */

export interface ShiftSchedule {
  timeZone: string;
  loginTime: string; // "HH:mm"
  logoutTime: string; // "HH:mm"
  graceMinutes: number;
}

export const DEFAULT_SCHEDULE: ShiftSchedule = {
  timeZone: "Asia/Dubai",
  loginTime: "09:00",
  logoutTime: "18:00",
  graceMinutes: 15,
};

/** The wall-clock date (YYYY-MM-DD) "now" in the given time zone. */
export function todayInTz(tz: string, now = new Date()): string {
  // en-CA yields ISO-style YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Convert a wall-clock date+time in `tz` to the corresponding UTC instant. */
export function zonedTimeToUtc(dateStr: string, timeStr: string, tz: string): Date {
  const naiveUtc = new Date(`${dateStr}T${timeStr}:00.000Z`);
  const asTz = new Date(naiveUtc.toLocaleString("en-US", { timeZone: tz }));
  const asUtc = new Date(naiveUtc.toLocaleString("en-US", { timeZone: "UTC" }));
  const offset = asTz.getTime() - asUtc.getTime();
  return new Date(naiveUtc.getTime() - offset);
}

export interface ResolvedShift {
  timeZone: string;
  dateStr: string;
  /** Midnight of the local day, as a UTC instant (used as the attendance `date`). */
  dateMidnightUtc: Date;
  shiftStart: Date;
  shiftEnd: Date;
  /** Clock-in becomes available 30 min before shift start. */
  windowOpen: Date;
  /** On-time boundary (shiftStart + grace). */
  lateThreshold: Date;
  /** Beyond this (shiftStart + 2h) a late arrival is a half-day. */
  halfDayThreshold: Date;
}

const HALF_DAY_AFTER_MINUTES = 120; // 2 hours late → half day

export function resolveShift(schedule: ShiftSchedule, now = new Date()): ResolvedShift {
  const tz = schedule.timeZone || DEFAULT_SCHEDULE.timeZone;
  const dateStr = todayInTz(tz, now);
  const dateMidnightUtc = zonedTimeToUtc(dateStr, "00:00", tz);
  const shiftStart = zonedTimeToUtc(dateStr, schedule.loginTime, tz);
  let shiftEnd = zonedTimeToUtc(dateStr, schedule.logoutTime, tz);
  if (shiftEnd.getTime() <= shiftStart.getTime()) {
    shiftEnd = new Date(shiftEnd.getTime() + 86_400_000); // overnight shift
  }
  const windowOpen = new Date(shiftStart.getTime() - 30 * 60_000);
  const lateThreshold = new Date(shiftStart.getTime() + (schedule.graceMinutes ?? 15) * 60_000);
  const halfDayThreshold = new Date(shiftStart.getTime() + HALF_DAY_AFTER_MINUTES * 60_000);
  return { timeZone: tz, dateStr, dateMidnightUtc, shiftStart, shiftEnd, windowOpen, lateThreshold, halfDayThreshold };
}

/** Status for a clock-in at `now` given the resolved shift. */
export function statusForClockIn(now: Date, shift: ResolvedShift): "present" | "late" | "half_day" {
  if (now.getTime() <= shift.lateThreshold.getTime()) return "present";
  if (now.getTime() <= shift.halfDayThreshold.getTime()) return "late";
  return "half_day";
}
