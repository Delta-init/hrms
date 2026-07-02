import { z } from "zod";

const line = z.object({
  label: z.string().min(1, "Label required").max(60),
  amount: z.coerce.number().min(0),
});

export const payslipFormSchema = z.object({
  employee: z.string().min(1, "Employee is required"),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Pick a month"),
  currency: z.string().min(1).max(6),
  earnings: z.array(line),
  deductions: z.array(line),
  status: z.enum(["draft", "issued", "paid"]),
  notes: z.string().max(500).optional(),
});

export type PayslipFormValues = z.infer<typeof payslipFormSchema>;
