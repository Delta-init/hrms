import { LeavePolicy } from "../models/LeavePolicy.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Employee } from "../models/Employee.js";
import { User } from "../models/User.js";
import type { CreateLeavePolicyInput, UpdateLeavePolicyInput } from "../validations/leavePolicyValidation.js";
import type { ILeaveBalance, LeaveType } from "../types/index.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";

const round = (n: number) => Math.round(n * 100) / 100;

/** Days of `type` approved for `userId` with a start date inside the given year. */
async function usedInYear(userId: string, type: LeaveType, year: number): Promise<number> {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  // Org-scoped: userId comes from a route param, so an unscoped query would
  // return another tenant's approved-leave totals for that user.
  const rows = await LeaveRequest.find(scoped({
    user: userId, type, status: "approved", startDate: { $gte: start, $lt: end },
  })).select("days").lean();
  return round(rows.reduce((a, r) => a + (r.days || 0), 0));
}

/**
 * Entitlement for `year` under `policy`, given the employee's joining date.
 * - Not yet joined by year end, or no joining date on record → 0.
 * - accrueMonthly: pro-rated by whole months from max(Jan 1, joining month)
 *   through min(today, Dec 31), capped at annualDays.
 * - Otherwise: the full annualDays, as soon as the employee has joined.
 */
function entitlementFor(policy: { annualDays: number; accrueMonthly: boolean }, joiningDate: Date | null, year: number): number {
  if (!joiningDate) return 0;
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  if (joiningDate > yearEnd) return 0;

  if (!policy.accrueMonthly) return round(policy.annualDays);

  const now = new Date();
  const periodStart = joiningDate > yearStart ? joiningDate : yearStart;
  const periodEnd = now < yearEnd ? now : yearEnd;
  if (periodEnd < periodStart) return 0;

  const startMonth = periodStart.getUTCFullYear() === year ? periodStart.getUTCMonth() : 0;
  const endMonth = periodEnd.getUTCFullYear() === year ? periodEnd.getUTCMonth() : 11;
  const monthsElapsed = Math.min(12, Math.max(0, endMonth - startMonth + 1));
  return round(Math.min(policy.annualDays, (policy.annualDays / 12) * monthsElapsed));
}

/**
 * The work schedule a person is on. The login's own schedule wins over the
 * employee record's, matching how leave and payroll resolve it elsewhere.
 */
async function scheduleIdFor(userId: string): Promise<string | null> {
  const [user, emp] = await Promise.all([
    User.findOne(scoped({ _id: userId })).select("workSchedule").lean<{ workSchedule?: unknown } | null>(),
    Employee.findOne(scoped({ user: userId })).select("workSchedule").lean<{ workSchedule?: unknown } | null>(),
  ]);
  const id = user?.workSchedule ?? emp?.workSchedule;
  return id ? String(id) : null;
}

export class LeaveBalanceService {
  // ── Policies ──────────────────────────────────────────────────────────────
  async createPolicy(input: CreateLeavePolicyInput) {
    // Clashes are per schedule now: one policy per type per schedule, plus an
    // org-wide one that covers everybody else.
    const workSchedule = input.workSchedule ?? null;
    const existing = await LeavePolicy.findOne(scoped({ type: input.type, workSchedule }));
    if (existing) {
      throw Object.assign(
        new Error(
          workSchedule
            ? `A policy for ${input.type} leave already exists on that work schedule`
            : `An organization-wide policy for ${input.type} leave already exists`
        ),
        { statusCode: 409 }
      );
    }
    return LeavePolicy.create({ organization: getOrgId(), ...input, workSchedule });
  }

  async listPolicies() {
    return LeavePolicy.find(orgFilter())
      .populate("workSchedule", "name")
      .sort({ type: 1, workSchedule: 1 });
  }

  async updatePolicy(id: string, input: UpdateLeavePolicyInput) {
    const record = await LeavePolicy.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Leave policy not found"), { statusCode: 404 });

    // Moving a policy to another schedule can collide with one already there.
    if (input.workSchedule !== undefined) {
      const target = input.workSchedule ?? null;
      const clash = await LeavePolicy.findOne(scoped({ type: record.type, workSchedule: target, _id: { $ne: record._id } }));
      if (clash) {
        throw Object.assign(
          new Error(`A policy for ${record.type} leave already exists there`),
          { statusCode: 409 }
        );
      }
    }

    Object.assign(record, input);
    await record.save();
    return LeavePolicy.findById(record._id).populate("workSchedule", "name");
  }

  async removePolicy(id: string) {
    const record = await LeavePolicy.findOneAndDelete(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Leave policy not found"), { statusCode: 404 });
    return { message: "Leave policy deleted successfully" };
  }

  /**
   * Every policy's balance for `userId` in `year` (default: current year).
   * Carry-forward looks back exactly one year (not compounded further back).
   */
  async computeBalances(userId: string, year = new Date().getUTCFullYear()): Promise<ILeaveBalance[]> {
    const [allPolicies, employee, scheduleId] = await Promise.all([
      LeavePolicy.find(orgFilter()).sort({ type: 1 }).lean(),
      Employee.findOne(scoped({ user: userId })).select("joiningDate").lean(),
      scheduleIdFor(userId),
    ]);
    const joiningDate = employee?.joiningDate ? new Date(employee.joiningDate) : null;

    // Only what applies to this person: their schedule's policy, or the
    // org-wide one where their schedule has nothing of that type. A policy
    // written for another schedule is not theirs and must not show a balance.
    const byType = new Map<string, (typeof allPolicies)[number]>();
    for (const p of allPolicies) {
      const target = p.workSchedule ? String(p.workSchedule) : null;
      if (target && target !== scheduleId) continue;
      const chosen = byType.get(p.type);
      // A schedule-specific policy overrides the organization-wide default.
      if (!chosen || (target && !chosen.workSchedule)) byType.set(p.type, p);
    }
    const policies = [...byType.values()].sort((a, b) => a.type.localeCompare(b.type));

    const results: ILeaveBalance[] = [];
    for (const policy of policies) {
      const accrued = entitlementFor(policy, joiningDate, year);
      const used = await usedInYear(userId, policy.type, year);

      let carriedForward = 0;
      if (policy.carryForwardLimit > 0) {
        const prevEntitlement = entitlementFor(policy, joiningDate, year - 1);
        const prevUsed = await usedInYear(userId, policy.type, year - 1);
        carriedForward = round(Math.min(policy.carryForwardLimit, Math.max(0, prevEntitlement - prevUsed)));
      }

      results.push({
        type: policy.type, year, annualDays: policy.annualDays,
        accrued, carriedForward, used,
        balance: round(accrued + carriedForward - used),
      });
    }
    return results;
  }
}
