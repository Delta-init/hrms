import { z } from "zod";

export const attendancePenaltyFormSchema = z.object({
  enabled: z.boolean(),
  graceLates: z.coerce.number().int().min(0, "Must be 0 or more").max(31),
  lateBlockSize: z.coerce.number().int().min(1, "Must be at least 1").max(31),
  unrecordedDaysUnpaid: z.boolean(),
  /** "YYYY-MM-DD", or empty to charge every past day of the month. */
  unrecordedFrom: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Pick a date").nullish(),
  monthlyRegularizationLimit: z.coerce.number().int().min(0, "Must be 0 or more").max(31),
  defaultRegularizationStatus: z.enum(["present", "half_day", "wfh", "early_out"]),
});

export type AttendancePenaltyFormValues = z.infer<typeof attendancePenaltyFormSchema>;
