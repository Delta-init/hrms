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
 * The filter is written so a holiday with no work mode still reaches everybody.
 * Every holiday that existed before this field did has none, and they were
 * created meaning the whole organisation — so nothing about them changes.
 */
export function holidayScope(workMode: WorkMode | null | undefined): Record<string, unknown> {
  // Somebody with no work mode on record — an account with no employee — is
  // reached only by the holidays that are everybody's, which is the safe answer
  // for a login that is not a person.
  const mine: Array<Record<string, unknown>> = [{ workMode: null }, { workMode: { $exists: false } }];
  if (workMode) mine.push({ workMode });
  return { $or: mine };
}

/** The work mode of one login, for the readers that only have a user id. */
export async function workModeOfUser(userId: unknown): Promise<WorkMode | null> {
  const emp = await Employee.findOne(scoped({ user: userId }))
    .select("workMode")
    .lean<{ workMode?: WorkMode } | null>();
  return emp?.workMode ?? null;
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
  end: Date
): Promise<Set<string>> {
  const rows = await Holiday.find({
    ...orgFilter(),
    date: { $gte: start, $lt: end },
    ...holidayScope(workMode),
  })
    .select("date")
    .lean();
  return new Set(rows.map((h) => new Date(h.date).toISOString().slice(0, 10)));
}
