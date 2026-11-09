import { AttendancePenaltyPolicy } from "../models/AttendancePenaltyPolicy.js";
import type { UpsertAttendancePenaltyPolicyInput } from "../validations/attendancePenaltyValidation.js";
import type { IAttendancePenaltyPolicy } from "../types/index.js";
import { scoped, getOrgId } from "../utils/orgContext.js";

const DEFAULTS = {
  enabled: false, graceLates: 3, lateBlockSize: 3, unrecordedDaysUnpaid: false, unrecordedFrom: null,
  defaultRegularizationStatus: "present" as const, monthlyRegularizationLimit: 3,
};

/** The org's late-penalty policy, or sane defaults (disabled) if never configured. */
export async function getAttendancePenaltyPolicy(): Promise<
  Pick<
    IAttendancePenaltyPolicy,
    "enabled" | "graceLates" | "lateBlockSize" | "unrecordedDaysUnpaid" | "unrecordedFrom" | "defaultRegularizationStatus" | "monthlyRegularizationLimit"
  >
> {
  const record = await AttendancePenaltyPolicy.findOne(scoped({})).lean();
  if (!record) return DEFAULTS;
  return {
    enabled: record.enabled,
    graceLates: record.graceLates,
    lateBlockSize: record.lateBlockSize,
    unrecordedDaysUnpaid: record.unrecordedDaysUnpaid ?? false,
    unrecordedFrom: record.unrecordedFrom ?? null,
    defaultRegularizationStatus: record.defaultRegularizationStatus ?? "present",
    // Records written before the limit existed have no value at all — Mongoose
    // applies a default only on save — so the fallback lives here too.
    monthlyRegularizationLimit: record.monthlyRegularizationLimit ?? DEFAULTS.monthlyRegularizationLimit,
  };
}

/**
 * Whether a working day with nothing recorded on it is charged: the switch is
 * on, and the day is on or after the date it counts from. Payroll, the wallet
 * and the attendance calendar all ask this, so the three cannot disagree.
 */
export function chargesUnrecorded(
  policy: Pick<IAttendancePenaltyPolicy, "unrecordedDaysUnpaid" | "unrecordedFrom">,
  dayKey: string
): boolean {
  return !!policy.unrecordedDaysUnpaid && (!policy.unrecordedFrom || dayKey >= policy.unrecordedFrom);
}

/** Half-days of penalty LOP for a month with `lateCount` late arrivals under `policy`. */
export function computeLatePenaltyDays(
  lateCount: number,
  policy: Pick<IAttendancePenaltyPolicy, "enabled" | "graceLates" | "lateBlockSize">
): number {
  if (!policy.enabled || lateCount <= policy.graceLates) return 0;
  const penalized = lateCount - policy.graceLates;
  return Math.floor(penalized / policy.lateBlockSize) * 0.5;
}

export class AttendancePenaltyService {
  async get() {
    return getAttendancePenaltyPolicy();
  }

  async upsert(input: UpsertAttendancePenaltyPolicyInput) {
    const record = await AttendancePenaltyPolicy.findOneAndUpdate(
      scoped({}),
      { $set: input, $setOnInsert: { organization: getOrgId() } },
      { new: true, upsert: true }
    );
    return record;
  }
}
