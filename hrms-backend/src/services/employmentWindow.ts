import { Resignation } from "../models/Resignation.js";
import { scoped } from "../utils/orgContext.js";

/**
 * When somebody was actually on the payroll.
 *
 * Attendance and payroll both used to treat every working day of a month as
 * theirs, whether or not they had joined yet. A person starting on the 20th was
 * marked absent for the first nineteen days and counted as owing attendance for
 * the whole month. Both now ask this first.
 *
 * The end comes from an accepted or relieved resignation's last working day.
 * Pending and rejected ones are not departures, and a withdrawn one never was.
 */

export interface EmploymentWindow {
  /** First day on the payroll, or null when no joining date is on record. */
  from: string | null;
  /** Last day on the payroll, or null while still employed. */
  to: string | null;
}

const dayKey = (d: Date) => new Date(d).toISOString().slice(0, 10);

/** Whether `dayKey` (YYYY-MM-DD) falls inside the window. */
export function employedOn(w: EmploymentWindow, day: string): boolean {
  if (w.from && day < w.from) return false;
  if (w.to && day > w.to) return false;
  return true;
}

/**
 * How much of `month` (YYYY-MM) somebody was on the payroll for, 0 to 1.
 *
 * Counted in calendar days rather than working days, which is what a monthly
 * salary is quoted against: somebody who joins on the 20th has had a fifth of
 * the month, whichever days of it their schedule happens to fall on. Dividing
 * by the month's own length rather than a fixed thirty means a full February
 * comes out at exactly 1 instead of quietly short.
 */
export function employedFraction(w: EmploymentWindow, month: string): number {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = `${month}-01`;
  const last = `${month}-${String(days).padStart(2, "0")}`;

  const from = w.from && w.from > first ? w.from : first;
  const to = w.to && w.to < last ? w.to : last;
  // Joined after the month ended, or left before it began.
  if (from > to) return 0;

  const employed = Number(to.slice(8)) - Number(from.slice(8)) + 1;
  return Math.min(1, employed / days);
}

/**
 * Windows for a set of employees, keyed by employee id. Resolved in one query
 * rather than per person: a calendar or a payroll run walks everybody.
 */
export async function employmentWindows(
  employees: Array<{ _id: unknown; joiningDate?: Date | null }>
): Promise<Map<string, EmploymentWindow>> {
  const ids = employees.map((e) => e._id);
  const leaving = await Resignation.find(
    scoped({ employee: { $in: ids }, status: { $in: ["accepted", "relieved"] } })
  )
    .select("employee lastWorkingDay")
    .sort({ lastWorkingDay: 1 })
    .lean<Array<{ employee: unknown; lastWorkingDay?: Date | null }>>();

  // Earliest last-working-day wins: once they have gone, they have gone.
  const lastDay = new Map<string, string>();
  for (const r of leaving) {
    if (!r.lastWorkingDay) continue;
    const key = String(r.employee);
    if (!lastDay.has(key)) lastDay.set(key, dayKey(r.lastWorkingDay));
  }

  const out = new Map<string, EmploymentWindow>();
  for (const e of employees) {
    out.set(String(e._id), {
      from: e.joiningDate ? dayKey(e.joiningDate) : null,
      to: lastDay.get(String(e._id)) ?? null,
    });
  }
  return out;
}

/** The window for one employee. */
export async function employmentWindowFor(
  employee: { _id: unknown; joiningDate?: Date | null }
): Promise<EmploymentWindow> {
  return (await employmentWindows([employee])).get(String(employee._id))!;
}
