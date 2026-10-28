import { DEFAULT_SCHEDULE, DEFAULT_WORK_DAYS, localDayKey } from "./schedule.js";

/**
 * Somebody's working hours, as another system shows them: their work schedule's shift and days — or, with none
 * assigned, the default every attendance rule falls back on, said so — and their approved leave in a window, as the
 * calendar days it covers in the leave's own time zone. For the CS Portal's Mentor Calendar (the signed
 * directory, GET /integrations/directory/work-hours).
 */

export interface WorkHoursSchedule {
  name: string;
  timeZone: string;
  /** "HH:mm", in `timeZone`. */
  loginTime: string;
  logoutTime: string;
  /** 0 = Sunday … 6 = Saturday. */
  workDays: number[];
  halfDays: number[];
  mode: "fixed" | "duration";
  requiredHours: number | null;
  /** False: nobody assigned one, so this is the default the HRMS itself goes by. */
  assigned: boolean;
}

export interface WorkHoursLeave {
  type: string;
  /** YYYY-MM-DD, in the leave's time zone. */
  from: string;
  to: string;
  halfDay: boolean;
}

export interface WorkHoursRow {
  email: string;
  name: string;
  schedule: WorkHoursSchedule;
  leaves: WorkHoursLeave[];
}

type ScheduleDoc = {
  name?: string; timeZone?: string; loginTime?: string; logoutTime?: string; workDays?: number[]; halfDays?: number[];
  mode?: string; requiredHours?: number;
} | null | undefined;
type LeaveDoc = { type?: string; startDate: Date | string; endDate: Date | string; halfDay?: boolean; timeZone?: string };

export function scheduleOf(doc: ScheduleDoc): WorkHoursSchedule {
  if (!doc) {
    return {
      name: "Default", timeZone: DEFAULT_SCHEDULE.timeZone, loginTime: DEFAULT_SCHEDULE.loginTime, logoutTime: DEFAULT_SCHEDULE.logoutTime,
      workDays: [...DEFAULT_WORK_DAYS], halfDays: [], mode: "fixed", requiredHours: null, assigned: false,
    };
  }
  const mode = doc.mode === "duration" ? "duration" : "fixed";
  return {
    name: String(doc.name ?? ""),
    timeZone: doc.timeZone || DEFAULT_SCHEDULE.timeZone,
    loginTime: doc.loginTime || DEFAULT_SCHEDULE.loginTime,
    logoutTime: doc.logoutTime || DEFAULT_SCHEDULE.logoutTime,
    workDays: Array.isArray(doc.workDays) ? [...doc.workDays] : [...DEFAULT_WORK_DAYS],
    halfDays: Array.isArray(doc.halfDays) ? [...doc.halfDays] : [],
    mode,
    requiredHours: mode === "duration" ? Number(doc.requiredHours ?? 8) : null,
    assigned: true,
  };
}

/** The leave that touches [from, to] (YYYY-MM-DD), as the calendar days it covers in its own time zone. */
export function leavesIn(docs: LeaveDoc[], from: string, to: string): WorkHoursLeave[] {
  return docs
    .map((l) => {
      const tz = l.timeZone || DEFAULT_SCHEDULE.timeZone;
      return { type: String(l.type ?? ""), from: localDayKey(l.startDate, tz), to: localDayKey(l.endDate, tz), halfDay: l.halfDay === true };
    })
    .filter((l) => l.from <= to && l.to >= from)
    .sort((a, b) => a.from.localeCompare(b.from));
}
