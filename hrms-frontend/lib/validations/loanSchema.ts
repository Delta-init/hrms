import { z } from "zod";

export const loanFormSchema = z.object({
  employee: z.string().min(1, "Select an employee"),
  amount: z.coerce.number().min(0, "Cannot be negative"),
  purpose: z.string().max(200).optional(),
  disbursedDate: z.string().optional(),
  installments: z.coerce.number().min(1, "At least 1 instalment"),
  monthlyDeduction: z.coerce.number().min(0, "Cannot be negative"),
  amountRepaid: z.coerce.number().min(0).optional(),
  status: z.enum(["active", "closed", "cancelled"]).optional(),
  notes: z.string().max(500).optional(),
});

export type LoanFormValues = z.infer<typeof loanFormSchema>;
