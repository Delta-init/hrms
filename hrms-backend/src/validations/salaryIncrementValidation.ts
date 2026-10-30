import { z } from "zod";

const month = z.string().regex(/^\d{4}-\d{2}$/, "Effective month must be YYYY-MM");
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "A three-letter currency, e.g. AED");

export const createSalaryIncrementSchema = z.object({
  employee: z.string().min(1, "Employee is required"),
  newSalary: z.coerce.number().min(0, "Salary cannot be negative"),
  effectiveMonth: month,
  reason: z.string().max(500).optional(),
  /** The new salary's currency, when it changes with this increment (a transfer). Defaults to the employee's. */
  currency: currency.optional(),
});

export const updateSalaryIncrementSchema = z.object({
  newSalary: z.coerce.number().min(0).optional(),
  effectiveMonth: month.optional(),
  reason: z.string().max(500).optional().nullable(),
  currency: currency.optional(),
});

export type CreateSalaryIncrementInput = z.infer<typeof createSalaryIncrementSchema>;
export type UpdateSalaryIncrementInput = z.infer<typeof updateSalaryIncrementSchema>;
