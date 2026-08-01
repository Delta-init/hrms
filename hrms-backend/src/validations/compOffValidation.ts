import { z } from "zod";

export const grantCompOffSchema = z.object({
  employee: z.string().min(1, "Employee is required"),
  date: z.coerce.date(),
  amount: z.coerce.number().min(0.5, "Minimum 0.5 days").max(5, "Maximum 5 days"),
  reason: z.string().max(300).optional(),
});

export type GrantCompOffInput = z.infer<typeof grantCompOffSchema>;
