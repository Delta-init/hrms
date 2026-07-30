import { z } from "zod";

const typeEnum = z.enum(["annual", "sick", "casual", "unpaid", "maternity", "paternity", "wfh"]);

export const createLeavePolicySchema = z.object({
  type: typeEnum,
  annualDays: z.coerce.number().min(0, "Cannot be negative").max(365),
  accrueMonthly: z.boolean().default(true),
  carryForwardLimit: z.coerce.number().min(0, "Cannot be negative").max(365).default(0),
});

export const updateLeavePolicySchema = createLeavePolicySchema.omit({ type: true }).partial();

export type CreateLeavePolicyInput = z.infer<typeof createLeavePolicySchema>;
export type UpdateLeavePolicyInput = z.infer<typeof updateLeavePolicySchema>;
