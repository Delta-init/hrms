import { z } from "zod";

export const oneTimeFormSchema = z.object({
  employee: z.string().min(1, "Select an employee"),
  kind: z.enum(["payment", "deduction"]),
  label: z.string().min(1, "Label is required").max(80),
  amount: z.coerce.number().min(0, "Cannot be negative"),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Pick a month"),
  notes: z.string().max(300).optional(),
});

export type OneTimeFormValues = z.infer<typeof oneTimeFormSchema>;
