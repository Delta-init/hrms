import { z } from "zod";

export const salaryIncrementFormSchema = z.object({
  employee: z.string().min(1, "Select an employee"),
  newSalary: z.coerce.number().min(0, "Cannot be negative"),
  effectiveMonth: z.string().regex(/^\d{4}-\d{2}$/, "Pick an effective month"),
  reason: z.string().max(500).optional(),
  /** The new salary's currency — different from the current one for a transfer. */
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Three letters, e.g. AED").optional().or(z.literal("")),
});

export type SalaryIncrementFormValues = z.infer<typeof salaryIncrementFormSchema>;
