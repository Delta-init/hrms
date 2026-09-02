import { LeavePolicy } from "../models/LeavePolicy.js";
import { Employee } from "../models/Employee.js";
import { LeaveAdjustment } from "../models/LeaveAdjustment.js";
import type { CreateLeavePolicyInput, UpdateLeavePolicyInput } from "../validations/leavePolicyValidation.js";
import type { ILeaveBalance } from "../types/index.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import {
  leavePolicyIndex, scheduleIdFor, accruedFor, usedInPeriod, carriedForward, leaveLabel, eligibilityFor,
} from "./leavePolicyResolver.js";

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Why a policy could not be saved, in terms of what it was aimed at.
 *
 * "Already exists" on its own sends somebody looking through a list for a
 * duplicate that is not there — the existing one is aimed somewhere else, and
 * naming the target is what makes that visible.
 */
function clashMessage(
  type: string,
  label: string | null | undefined,
  workSchedule: string | null,
  workMode: "office" | "wfh" | null
): string {
  const name = leaveLabel(type, label);
  if (workMode) return `A policy for ${name} already covers ${workMode === "wfh" ? "work-from-home" : "office"} staff`;
  if (workSchedule) return `A policy for ${name} already exists on that work schedule`;
  return `An organization-wide policy for ${name} already exists`;
}

export class LeaveBalanceService {
  // ── Policies ──────────────────────────────────────────────────────────────
  async createPolicy(input: CreateLeavePolicyInput) {
    // Clashes are per target: one policy per type per schedule, one per type
    // per work mode, and one org-wide that covers everybody else.
    const workSchedule = input.workSchedule ?? null;
    const workMode = input.workMode ?? null;
    const existing = await LeavePolicy.findOne(scoped({ type: input.type, workSchedule, workMode }));
    if (existing) throw Object.assign(new Error(clashMessage(input.type, input.label, workSchedule, workMode)), { statusCode: 409 });

    /**
     * Stamped now, and this is the whole point of the field.
     *
     * Balances are computed from policies rather than stored, so without a
     * start date a policy saved today silently governs the year already gone —
     * turning leave people have taken and been paid for into an overdraft.
     */
    return LeavePolicy.create({
      organization: getOrgId(),
      ...input,
      workSchedule,
      workMode,
      effectiveFrom: new Date(),
    });
  }

  async listPolicies() {
    return LeavePolicy.find(orgFilter())
      .populate("workSchedule", "name")
      // Most specific last, matching how they override each other, so the list
      // reads in the order the resolver applies them.
      .sort({ type: 1, workSchedule: 1, workMode: 1 });
  }

  async updatePolicy(id: string, input: UpdateLeavePolicyInput) {
    const record = await LeavePolicy.findOne(scoped({ _id: id }));
    if (!record) throw Object.assign(new Error("Leave policy not found"), { statusCode: 404 });

    // Re-aiming a policy can collide with one already covering that target.
    if (input.workSchedule !== undefined || input.workMode !== undefined) {
      const workSchedule = input.workSchedule !== undefined ? input.workSchedule ?? null : record.workSchedule ?? null;
      const workMode = input.workMode !== undefined ? input.workMode ?? null : record.workMode ?? null;
      const clash = await LeavePolicy.findOne(
        scoped({ type: record.type, workSchedule, workMode, _id: { $ne: record._id } })
      );
      if (clash) {
        throw Object.assign(
          new Error(clashMessage(record.type, record.label, workSchedule as never, workMode)),
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
   * Every policy in force for `userId`, with what it has granted so far.
   *
   * A monthly policy is reported for the month in progress; a yearly one for
   * `year`. Carry-forward looks back exactly one year, never compounded.
   */
  async computeBalances(userId: string, year = new Date().getUTCFullYear()): Promise<ILeaveBalance[]> {
    const [index, scheduleId, employee, adjustments] = await Promise.all([
      leavePolicyIndex(),
      scheduleIdFor(userId),
      Employee.findOne(scoped({ user: userId })).select("joiningDate workMode").lean(),
      // Corrections the rules cannot derive — an opening balance carried over
      // from another system, or a manual credit HR owes somebody.
      LeaveAdjustment.find(scoped({ user: userId, year })).select("type days").lean(),
    ]);
    const adjustedBy = new Map<string, number>();
    for (const a of adjustments) {
      adjustedBy.set(a.type, (adjustedBy.get(a.type) ?? 0) + a.days);
    }
    const joiningDate = employee?.joiningDate ? new Date(employee.joiningDate) : null;
    const policies = index.for(scheduleId, employee?.workMode ?? null);

    // Read each policy as of the latest moment of `year` that has actually
    // happened. Anchoring a yearly policy to 1 January made someone who
    // qualified in April still read as ineligible in August.
    const now = new Date();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year, 11, 31));
    const asOf = now < yearStart ? yearStart : now > yearEnd ? yearEnd : now;
    const onFor = (period: string) =>
      period === "month" && year !== now.getUTCFullYear() ? new Date(Date.UTC(year, 11, 1)) : asOf;

    const results: ILeaveBalance[] = [];
    for (const policy of policies) {
      const on = onFor(policy.period);
      const accrued = accruedFor(policy, joiningDate, on);
      const eligibility = eligibilityFor(policy, joiningDate, on);
      const used = await usedInPeriod(userId, policy.type, policy.period, on);

      const carried = policy.period === "year"
        ? carriedForward(policy, joiningDate, year,
            await usedInPeriod(userId, policy.type, "year", new Date(Date.UTC(year - 1, 0, 1))))
        : 0;

      const adjustment = adjustedBy.get(policy.type) ?? 0;

      results.push({
        type: policy.type,
        label: policy.label,
        year,
        period: policy.period,
        paid: policy.paid,
        days: policy.days,
        accrued,
        carriedForward: carried,
        adjustment,
        used,
        balance: round(accrued + carried + adjustment - used),
        eligibleAfterMonths: policy.eligibleAfterMonths,
        eligible: eligibility.eligible,
        eligibleOn: eligibility.eligibleOn ? eligibility.eligibleOn.toISOString() : null,
        joiningDateMissing: eligibility.joiningDateMissing,
      });
    }
    return results;
  }

}
