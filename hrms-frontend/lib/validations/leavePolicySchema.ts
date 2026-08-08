import { z } from "zod";

export const leavePolicyFormSchema = z.object({
  type: z.enum(["annual", "sick", "casual", "unpaid", "maternity", "paternity", "wfh"]),
  /** "" means every employee in the organization. */
  workSchedule: z.string(),
  annualDays: z.coerce.number().min(0, "Cannot be negative").max(365),
  accrueMonthly: z.boolean(),
  carryForwardLimit: z.coerce.number().min(0, "Cannot be negative").max(365),
});

export type LeavePolicyFormValues = z.infer<typeof leavePolicyFormSchema>;
