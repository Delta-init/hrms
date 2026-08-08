/**
 * Working days assumed when nobody has assigned a schedule: Sunday off.
 *
 * One constant because it was written out in six services, and a default that
 * disagrees with itself is worse than one that is merely wrong — leave counted
 * a month at Mon–Fri while payroll charged Mon–Sat for the same person.
 */
export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5, 6]; // Mon–Sat (0 = Sunday)

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

/**
 * The calendar day an instant falls on, seen from `tz`.
 *
 * Attendance stores a day as its local midnight expressed in UTC, so a Dubai
 * day of the 8th is 20:00Z on the 7th. Reading that back with the UTC date
 * lands it on the wrong day; this reads it in the timezone it was written for.
 */
export function localDayKey(instant: Date | string | number, tz: string): string {
  return todayInTz(tz, new Date(instant));
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
