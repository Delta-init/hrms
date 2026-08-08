import { LeavePolicy } from "../models/LeavePolicy.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import type { LeavePeriod } from "../types/index.js";
import { scoped, orgFilter } from "../utils/orgContext.js";

/**
 * Which leave policies apply to whom.
 *
 * Leave used to be configured in two places — an allowance on the work schedule
 * and a policy of its own — so "how much sick leave does this person get" had
 * two answers. Everything reads through here now: the request form, the payslip
 * (paid or Loss of Pay), the attendance calendar and the balance card.
 */

export interface EffectivePolicy {
  _id: unknown;
  type: string;
  label: string;
  days: number;
  period: LeavePeriod;
  paid: boolean;
  /** Months of service before this leave can be taken. 0 = from day one. */
  eligibleAfterMonths: number;
  carryForwardLimit: number;
  /** Which schedule granted it — null when it is the organization-wide one. */
  workSchedule: string | null;
}

export const BUILTIN_LEAVE_LABELS: Record<string, string> = {
  annual: "Annual leave", sick: "Sick leave", casual: "Casual leave", unpaid: "Unpaid leave",
  maternity: "Maternity leave", paternity: "Paternity leave", wfh: "Work from home", comp_off: "Comp-off",
};

/** What to call a type: the policy's own name, else the built-in one, else the slug. */
export const leaveLabel = (type: string, label?: string | null): string =>
  label?.trim() || BUILTIN_LEAVE_LABELS[type] || type;

const round = (n: number) => Math.round(n * 100) / 100;

function shape(p: {
  _id: unknown; type: string; label?: string | null; days: number; period?: LeavePeriod;
  paid?: boolean; eligibleAfterMonths?: number; carryForwardLimit?: number; workSchedule?: unknown;
}): EffectivePolicy {
  return {
    _id: p._id,
    type: p.type,
    label: leaveLabel(p.type, p.label),
    days: p.days,
    period: p.period ?? "year",
    paid: p.paid !== false,
    eligibleAfterMonths: p.eligibleAfterMonths ?? 0,
    carryForwardLimit: p.carryForwardLimit ?? 0,
    workSchedule: p.workSchedule ? String(p.workSchedule) : null,
  };
}

/**
 * Loads every policy in the organization once, then resolves per schedule in
 * memory. The calendar and a payroll run both walk dozens of employees, and a
 * query each would turn one page into dozens.
 */
export async function leavePolicyIndex() {
  const all = await LeavePolicy.find(orgFilter()).lean();
  const shaped = all.map((p) => shape(p as never));

  return {
    /** The policies in force for someone on `scheduleId` (null = no schedule). */
    for(scheduleId: string | null): EffectivePolicy[] {
      const byType = new Map<string, EffectivePolicy>();
      for (const p of shaped) {
        // A policy written for another schedule is not this person's.
        if (p.workSchedule && p.workSchedule !== scheduleId) continue;
        const chosen = byType.get(p.type);
        // Their schedule's own policy overrides the organization-wide default.
        if (!chosen || (p.workSchedule && !chosen.workSchedule)) byType.set(p.type, p);
      }
      return [...byType.values()].sort((a, b) => a.label.localeCompare(b.label));
    },
  };
}

/**
 * The work schedule a person is on. The login's own wins over the employee
 * record's, matching how payroll resolves it.
 */
export async function scheduleIdFor(userId: unknown): Promise<string | null> {
  const [user, emp] = await Promise.all([
    User.findOne(scoped({ _id: userId })).select("workSchedule").lean<{ workSchedule?: unknown } | null>(),
    Employee.findOne(scoped({ user: userId })).select("workSchedule").lean<{ workSchedule?: unknown } | null>(),
  ]);
  const id = user?.workSchedule ?? emp?.workSchedule;
  return id ? String(id) : null;
}

/** The policies in force for one person. */
export async function policiesForUser(userId: unknown): Promise<EffectivePolicy[]> {
  const [index, scheduleId] = await Promise.all([leavePolicyIndex(), scheduleIdFor(userId)]);
  return index.for(scheduleId);
}

// ── Entitlement ──────────────────────────────────────────────────────────────

/** The window a policy's allowance is counted over, for leave starting on `on`. */
export function periodWindow(period: LeavePeriod, on: Date): { start: Date; end: Date; year: number } {
  const y = on.getUTCFullYear();
  if (period === "month") {
    const m = on.getUTCMonth();
    return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1)), year: y };
  }
  return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y + 1, 0, 1)), year: y };
}

/** The date someone becomes eligible under `policy`, or null if there is no
 *  joining date to measure from. */
export function eligibleOnFor(
  policy: Pick<EffectivePolicy, "eligibleAfterMonths">,
  joiningDate: Date | null
): Date | null {
  if (!joiningDate) return null;
  if (!policy.eligibleAfterMonths) return joiningDate;
  const d = new Date(joiningDate);
  d.setUTCMonth(d.getUTCMonth() + policy.eligibleAfterMonths);
  return d;
}

export interface Eligibility {
  eligible: boolean;
  /** When they qualify, or null if already qualified or unknowable. */
  eligibleOn: Date | null;
  /** True when there is no joining date to measure service from. */
  joiningDateMissing: boolean;
}

/**
 * Whether `policy` is open to somebody by `on`.
 *
 * Measured from the joining date, so "eligible after 3 months" is a fact about
 * the person rather than a rule someone has to remember. A policy with no
 * waiting period is open from day one and needs no joining date at all.
 *
 * With a waiting period and no joining date on record we cannot tell, and we
 * grant it: an active employee silently earning nothing, with nothing on screen
 * explaining why, is the worse of the two mistakes. The caller is told so it
 * can say as much.
 */
export function eligibilityFor(
  policy: Pick<EffectivePolicy, "eligibleAfterMonths">,
  joiningDate: Date | null,
  on: Date
): Eligibility {
  if (!policy.eligibleAfterMonths) return { eligible: true, eligibleOn: null, joiningDateMissing: !joiningDate };
  if (!joiningDate) return { eligible: true, eligibleOn: null, joiningDateMissing: true };
  const eligibleOn = eligibleOnFor(policy, joiningDate)!;
  const eligible = on >= eligibleOn;
  return { eligible, eligibleOn: eligible ? null : eligibleOn, joiningDateMissing: false };
}

/**
 * What the policy grants for the period containing `on`: the full days once
 * eligible, nothing before that.
 *
 * Entitlement used to be pro-rated month by month across the year, which meant
 * a yearly allowance was never really "20 days" — it was however many twelfths
 * had gone by. A waiting period says the same thing more plainly: nothing until
 * you qualify, the whole allowance afterwards.
 */
export function accruedFor(
  policy: Pick<EffectivePolicy, "days" | "period" | "eligibleAfterMonths">,
  joiningDate: Date | null,
  on: Date
): number {
  const { end } = periodWindow(policy.period, on);
  // Joined after this period had already finished — nothing for it.
  if (joiningDate && joiningDate >= end) return 0;
  return eligibilityFor(policy, joiningDate, on).eligible ? round(policy.days) : 0;
}

/** Days of `type` already booked in the period containing `on`. */
export async function usedInPeriod(
  userId: unknown,
  type: string,
  period: LeavePeriod,
  on: Date,
  opts: { includePending?: boolean; excludeId?: string | null } = {}
): Promise<number> {
  const { start, end } = periodWindow(period, on);
  const filter: Record<string, unknown> = {
    user: userId,
    type,
    status: opts.includePending ? { $in: ["pending", "approved"] } : "approved",
    startDate: { $gte: start, $lt: end },
  };
  if (opts.excludeId) filter._id = { $ne: opts.excludeId };
  const rows = await LeaveRequest.find(scoped(filter)).select("days").lean();
  return round(rows.reduce((a, r) => a + (r.days || 0), 0));
}

/** Unused days brought forward from last year. Yearly policies only. */
export function carriedForward(
  policy: Pick<EffectivePolicy, "days" | "period" | "eligibleAfterMonths" | "carryForwardLimit">,
  joiningDate: Date | null,
  year: number,
  usedLastYear: number
): number {
  if (policy.period === "month" || policy.carryForwardLimit <= 0) return 0;
  const last = accruedFor(policy, joiningDate, new Date(Date.UTC(year - 1, 0, 1)));
  return round(Math.min(policy.carryForwardLimit, Math.max(0, last - usedLastYear)));
}
