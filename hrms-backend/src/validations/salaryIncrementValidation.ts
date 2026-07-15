import { z } from "zod";

const month = z.string().regex(/^\d{4}-\d{2}$/, "Effective month must be YYYY-MM");

export const createSalaryIncrementSchema = z.object({
  employee: z.string().min(1, "Employee is required"),
  newSalary: z.coerce.number().min(0, "Salary cannot be negative"),
  effectiveMonth: month,
  reason: z.string().max(500).optional(),
});

export const updateSalaryIncrementSchema = z.object({
  newSalary: z.coerce.number().min(0).optional(),
  effectiveMonth: month.optional(),
  reason: z.string().max(500).optional().nullable(),
});

export type CreateSalaryIncrementInput = z.infer<typeof createSalaryIncrementSchema>;
export type UpdateSalaryIncrementInput = z.infer<typeof updateSalaryIncrementSchema>;
