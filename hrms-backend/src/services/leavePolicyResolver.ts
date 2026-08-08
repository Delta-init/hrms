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
  accrueMonthly: boolean;
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
  paid?: boolean; accrueMonthly?: boolean; carryForwardLimit?: number; workSchedule?: unknown;
}): EffectivePolicy {
  return {
    _id: p._id,
    type: p.type,
    label: leaveLabel(p.type, p.label),
    days: p.days,
    period: p.period ?? "year",
    paid: p.paid !== false,
    accrueMonthly: p.accrueMonthly !== false,
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

/**
 * What the policy has granted by now for the period containing `on`.
 *
 * - No joining date on record, or not joined yet → nothing.
 * - Monthly policies grant their days whole at the start of each month; there
 *   is nothing to pro-rate inside a month.
 * - Yearly policies with accrueMonthly build up a twelfth a month from the
 *   later of January and the joining month; otherwise the full amount lands as
 *   soon as the person has joined.
 */
export function accruedFor(
  policy: Pick<EffectivePolicy, "days" | "period" | "accrueMonthly">,
  joiningDate: Date | null,
  on: Date,
  now = new Date()
): number {
  if (!joiningDate) return 0;
  const { start, end, year } = periodWindow(policy.period, on);
  if (joiningDate >= end) return 0;

  if (policy.period === "month") return round(policy.days);
  if (!policy.accrueMonthly) return round(policy.days);

  const yearEnd = new Date(Date.UTC(year, 11, 31));
  const periodStart = joiningDate > start ? joiningDate : start;
  const periodEnd = now < yearEnd ? now : yearEnd;
  if (periodEnd < periodStart) return 0;

  const startMonth = periodStart.getUTCFullYear() === year ? periodStart.getUTCMonth() : 0;
  const endMonth = periodEnd.getUTCFullYear() === year ? periodEnd.getUTCMonth() : 11;
  const months = Math.min(12, Math.max(0, endMonth - startMonth + 1));
  return round(Math.min(policy.days, (policy.days / 12) * months));
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
  policy: Pick<EffectivePolicy, "days" | "period" | "accrueMonthly" | "carryForwardLimit">,
  joiningDate: Date | null,
  year: number,
  usedLastYear: number
): number {
  if (policy.period === "month" || policy.carryForwardLimit <= 0) return 0;
  const last = accruedFor(policy, joiningDate, new Date(Date.UTC(year - 1, 0, 1)));
  return round(Math.min(policy.carryForwardLimit, Math.max(0, last - usedLastYear)));
}
