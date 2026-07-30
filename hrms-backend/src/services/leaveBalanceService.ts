import { LeavePolicy } from "../models/LeavePolicy.js";
import { LeaveRequest } from "../models/LeaveRequest.js";
import { Employee } from "../models/Employee.js";
import type { CreateLeavePolicyInput, UpdateLeavePolicyInput } from "../validations/leavePolicyValidation.js";
import type { ILeaveBalance, LeaveType } from "../types/index.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";

const round = (n: number) => Math.round(n * 100) / 100;

/** Days of `type` approved for `userId` with a start date inside the given year. */
async function usedInYear(userId: string, type: LeaveType, year: number): Promise<number> {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const rows = await LeaveRequest.find({
    user: userId, type, status: "approved", startDate: { $gte: start, $lt: end },
  }).select("days").lean();
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

export class LeaveBalanceService {
  // ── Policies ──────────────────────────────────────────────────────────────
  async createPolicy(input: CreateLeavePolicyInput) {
    const existing = await LeavePolicy.findOne(scoped({ type: input.type }));
    if (existing) throw Object.assign(new Error(`A policy for ${input.type} leave already exists`), { statusCode: 409 });
    return LeavePolicy.create({ organization: getOrgId(), ...input });
  }

  async listPolicies() {
    return LeavePolicy.find(orgFilter()).sort({ type: 1 });
  }

  async updatePolicy(id: string, input: UpdateLeavePolicyInput) {
    const record = await LeavePolicy.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Leave policy not found"), { statusCode: 404 });
    Object.assign(record, input);
    await record.save();
    return record;
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
    const [policies, employee] = await Promise.all([
      LeavePolicy.find(orgFilter()).sort({ type: 1 }).lean(),
      Employee.findOne(scoped({ user: userId })).select("joiningDate").lean(),
    ]);
    const joiningDate = employee?.joiningDate ? new Date(employee.joiningDate) : null;

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
