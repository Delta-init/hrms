import { z } from "zod";

export const upsertAttendancePenaltyPolicySchema = z.object({
  enabled: z.boolean().default(false),
  graceLates: z.number().int().min(0).max(31).default(3),
  lateBlockSize: z.number().int().min(1).max(31).default(3),
});

export type UpsertAttendancePenaltyPolicyInput = z.infer<typeof upsertAttendancePenaltyPolicySchema>;
