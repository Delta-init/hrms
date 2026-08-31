import { z } from "zod";

export const attendancePenaltyFormSchema = z.object({
  enabled: z.boolean(),
  graceLates: z.coerce.number().int().min(0, "Must be 0 or more").max(31),
  lateBlockSize: z.coerce.number().int().min(1, "Must be at least 1").max(31),
  unrecordedDaysUnpaid: z.boolean(),
  monthlyRegularizationLimit: z.coerce.number().int().min(0, "Must be 0 or more").max(31),
  defaultRegularizationStatus: z.enum(["present", "half_day", "wfh"]),
});

export type AttendancePenaltyFormValues = z.infer<typeof attendancePenaltyFormSchema>;
