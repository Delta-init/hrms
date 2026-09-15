import { z } from "zod";

// `monthlyDeduction` is deliberately not part of this schema: the server
// always derives it from `amount`/`installments`, so the form never submits
// one — see LoanDialog, which only displays the figure it computes.
export const loanFormSchema = z.object({
  employee: z.string().min(1, "Select an employee"),
  amount: z.coerce.number().min(0, "Cannot be negative"),
  purpose: z.string().max(200).optional(),
  disbursedDate: z.string().optional(),
  installments: z.coerce.number().min(1, "At least 1 instalment"),
  amountRepaid: z.coerce.number().min(0).optional(),
  status: z.enum(["active", "closed", "cancelled"]).optional(),
  notes: z.string().max(500).optional(),
});

export type LoanFormValues = z.infer<typeof loanFormSchema>;
