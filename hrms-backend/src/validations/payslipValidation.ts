import { z } from "zod";

const line = z.object({
  label: z.string().min(1, "Label is required").max(60),
  amount: z.coerce.number().min(0),
});

export const createPayslipSchema = z.object({
  employee: z.string().min(1, "Employee is required"),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Month must be YYYY-MM"),
  currency: z.string().max(6).optional(),
  earnings: z.array(line).default([]),
  deductions: z.array(line).default([]),
  workingDays: z.coerce.number().min(0).optional(),
  paidDays: z.coerce.number().min(0).optional(),
  lopDays: z.coerce.number().min(0).optional(),
  status: z.enum(["draft", "issued", "paid"]).optional(),
  notes: z.string().max(500).optional(),
});

export const updatePayslipSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  currency: z.string().max(6).optional(),
  earnings: z.array(line).optional(),
  deductions: z.array(line).optional(),
  workingDays: z.coerce.number().min(0).optional(),
  paidDays: z.coerce.number().min(0).optional(),
  lopDays: z.coerce.number().min(0).optional(),
  status: z.enum(["draft", "issued", "paid"]).optional(),
  notes: z.string().max(500).optional().nullable(),
});

export type CreatePayslipInput = z.infer<typeof createPayslipSchema>;
export type UpdatePayslipInput = z.infer<typeof updatePayslipSchema>;
