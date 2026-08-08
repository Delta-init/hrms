import { LeavePolicy } from "../models/LeavePolicy.js";
import { Employee } from "../models/Employee.js";
import type { CreateLeavePolicyInput, UpdateLeavePolicyInput } from "../validations/leavePolicyValidation.js";
import type { ILeaveBalance } from "../types/index.js";
import { scoped, orgFilter, getOrgId } from "../utils/orgContext.js";
import {
  leavePolicyIndex, scheduleIdFor, accruedFor, usedInPeriod, carriedForward, leaveLabel,
} from "./leavePolicyResolver.js";

const round = (n: number) => Math.round(n * 100) / 100;

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
            ? `A policy for ${leaveLabel(input.type, input.label)} already exists on that work schedule`
            : `An organization-wide policy for ${leaveLabel(input.type, input.label)} already exists`
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
          new Error(`A policy for ${leaveLabel(record.type, record.label)} already exists there`),
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
    const [index, scheduleId, employee] = await Promise.all([
      leavePolicyIndex(),
      scheduleIdFor(userId),
      Employee.findOne(scoped({ user: userId })).select("joiningDate").lean(),
    ]);
    const joiningDate = employee?.joiningDate ? new Date(employee.joiningDate) : null;
    const policies = index.for(scheduleId);

    // Monthly allowances are about the month you are in; yearly ones about the
    // year being asked for. Showing a monthly figure against a past year would
    // be meaningless.
    const now = new Date();
    const onFor = (period: string) =>
      period === "month"
        ? (year === now.getUTCFullYear() ? now : new Date(Date.UTC(year, 11, 1)))
        : new Date(Date.UTC(year, 0, 1));

    const results: ILeaveBalance[] = [];
    for (const policy of policies) {
      const on = onFor(policy.period);
      const accrued = accruedFor(policy, joiningDate, on);
      const used = await usedInPeriod(userId, policy.type, policy.period, on);

      const carried = policy.period === "year"
        ? carriedForward(policy, joiningDate, year,
            await usedInPeriod(userId, policy.type, "year", new Date(Date.UTC(year - 1, 0, 1))))
        : 0;

      results.push({
        type: policy.type,
        label: policy.label,
        year,
        period: policy.period,
        paid: policy.paid,
        days: policy.days,
        accrued,
        carriedForward: carried,
        used,
        balance: round(accrued + carried - used),
      });
    }
    return results;
  }

}
