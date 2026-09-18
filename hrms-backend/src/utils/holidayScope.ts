import { Holiday } from "../models/Holiday.js";
import { Employee } from "../models/Employee.js";
import { orgFilter, scoped } from "../utils/orgContext.js";
import type { WorkMode } from "../types/index.js";

/**
 * Which holidays are this person's.
 *
 * A holiday used to be everybody's, because there was only one calendar. There
 * are two now — staff working from home in Kerala keep different days from
 * staff in the Dubai office — and a day off for one is an ordinary working day
 * for the other. Every reader has to ask whose calendar a holiday belongs to,
 * and six of them do: payroll, leave-day counting, the attendance calendar,
 * comp-off accrual, the punch reminder and the daily digest. Miss one and a
 * Kerala holiday quietly pays seventy-four people in Dubai for a day they
 * worked, or excuses them from a punch they should have made.
 *
 * `workMode` splits the org two ways; `scheduleId` narrows further, to exactly
 * the people on one schedule — Karnataka's calendar is not also every other
 * remote worker's just because both happen to be `workMode: wfh`.
 *
 * A schedule with holidays tagged to it has its own complete calendar and
 * means exactly that: for anyone on it, ONLY those tagged days count, not
 * the untagged work-mode calendar too — Karnataka's sixteen days is the
 * whole of it, not sixteen extra days added to Kerala's. A schedule with no
 * tagged holidays of its own (every schedule but one, today) is unaffected
 * and keeps falling back to the untagged, work-mode calendar exactly as
 * before — this only ever narrows a schedule that has opted in by having a
 * calendar at all.
 */
export async function holidayScope(
  workMode: WorkMode | null | undefined,
  scheduleId?: unknown
): Promise<Record<string, unknown>> {
  // Somebody with no work mode on record — an account with no employee — is
  // reached only by the holidays that are everybody's, which is the safe answer
  // for a login that is not a person.
  const workModeOr: Array<Record<string, unknown>> = [{ workMode: null }, { workMode: { $exists: false } }];
  if (workMode) workModeOr.push({ workMode });
  const untagged = {
    $and: [{ $or: [{ workSchedule: null }, { workSchedule: { $exists: false } }] }, { $or: workModeOr }],
  };
  if (!scheduleId) return untagged;
  const hasOwnCalendar = await Holiday.exists({ ...orgFilter(), workSchedule: scheduleId });
  if (hasOwnCalendar) return { workSchedule: scheduleId };
  return { $or: [untagged, { workSchedule: scheduleId }] };
}

/** The work mode of one login, for the readers that only have a user id. */
export async function workModeOfUser(userId: unknown): Promise<WorkMode | null> {
  const emp = await Employee.findOne(scoped({ user: userId }))
    .select("workMode")
    .lean<{ workMode?: WorkMode } | null>();
  return emp?.workMode ?? null;
}

/** The resolved work schedule id of one login, for the readers that only have a user id. */
export async function scheduleIdOfUser(userId: unknown): Promise<unknown> {
  const emp = await Employee.findOne(scoped({ user: userId }))
    .select("workSchedule")
    .lean<{ workSchedule?: unknown } | null>();
  return emp?.workSchedule ?? null;
}

/**
 * The days off for one person in a window, as "YYYY-MM-DD" keys.
 *
 * Returned as keys rather than documents because every caller does the same
 * thing with them — asks whether a given day is in the set — and each was
 * building that set slightly differently.
 */
export async function holidayKeysFor(
  workMode: WorkMode | null | undefined,
  start: Date,
  end: Date,
  scheduleId?: unknown
): Promise<Set<string>> {
  const rows = await Holiday.find({
    ...orgFilter(),
    date: { $gte: start, $lt: end },
    ...(await holidayScope(workMode, scheduleId)),
  })
    .select("date")
    .lean();
  return new Set(rows.map((h) => new Date(h.date).toISOString().slice(0, 10)));
}
