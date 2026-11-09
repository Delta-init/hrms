import { z } from "zod";

export const upsertAttendancePenaltyPolicySchema = z.object({
  enabled: z.boolean().default(false),
  graceLates: z.number().int().min(0).max(31).default(3),
  lateBlockSize: z.number().int().min(1).max(31).default(3),
  unrecordedDaysUnpaid: z.boolean().default(false),
  unrecordedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullish().transform((v) => v || null),
  monthlyRegularizationLimit: z.coerce.number().int().min(0).max(31).default(3),
  defaultRegularizationStatus: z.enum(["present", "half_day", "wfh", "early_out"]).default("present"),
});

export type UpsertAttendancePenaltyPolicyInput = z.infer<typeof upsertAttendancePenaltyPolicySchema>;
