import { z } from "zod";

export const grantCompOffFormSchema = z.object({
  employee: z.string().min(1, "Select an employee"),
  date: z.string().min(1, "Date is required"),
  amount: z.coerce.number().min(0.5, "Minimum 0.5 days").max(5, "Maximum 5 days"),
  reason: z.string().max(300).optional(),
});
export type GrantCompOffFormValues = z.infer<typeof grantCompOffFormSchema>;
