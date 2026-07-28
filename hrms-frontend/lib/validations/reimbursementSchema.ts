import { z } from "zod";

export const reimbursementFormSchema = z.object({
  employee: z.string().optional(),
  category: z.enum(["travel", "food", "accommodation", "medical", "communication", "fuel", "supplies", "other"]),
  title: z.string().min(1, "Title is required").max(120),
  amount: z.coerce.number().min(0, "Cannot be negative"),
  expenseDate: z.string().min(1, "Pick a date"),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Pick a month"),
  description: z.string().max(500).optional(),
  receiptUrl: z.string().max(500).optional(),
});

export type ReimbursementFormValues = z.infer<typeof reimbursementFormSchema>;
