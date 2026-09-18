import type { EmployeeStatus } from "../types/index.js";

/**
 * The statuses that mean somebody has gone.
 *
 * There are two because how somebody left matters to HR — a resignation and a
 * dismissal read very differently on a record — but to everything else in the
 * system they mean one thing: this person is no longer staff. Payroll, the
 * punch reminders, the digests, every picker and every headcount want the same
 * answer for both.
 *
 * Kept in one place because the alternative — `status: { $ne: "terminated" }`
 * written out at thirty call sites — is how adding the second one silently put
 * resigned people back on the payroll roster and back on the list of people
 * nagged to clock in. A third will only have to be added here.
 */
export const LEFT_STATUSES: readonly EmployeeStatus[] = ["terminated", "resigned"] as const;

/**
 * Mongo fragment for "still with the company".
 *
 * A function rather than a shared constant so no caller can spread it into a
 * query and then mutate the array everybody else is using.
 */
export const stillHere = () => ({ $nin: [...LEFT_STATUSES] });

/** Mongo fragment for "has left", however they left. */
export const hasLeftFilter = () => ({ $in: [...LEFT_STATUSES] });

/** Whether a status means this person has gone. */
export const hasLeft = (status?: string | null): boolean =>
  !!status && (LEFT_STATUSES as readonly string[]).includes(status);
