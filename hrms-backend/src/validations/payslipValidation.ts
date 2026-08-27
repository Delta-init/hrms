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

/** Acting on a selection of rows at once. Capped so one request cannot be
 *  turned into an unbounded write loop. */
export const bulkPayslipSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Select at least one payslip").max(500),
});

/**
 * "paid" is not accepted here any more.
 *
 * Marking somebody paid asserts that money left a bank account, and that
 * happens in the accounts system. It reaches a payslip over the payroll
 * integration at the end of the handover, never from the HR screen — otherwise
 * the three-step flow is optional and a payslip can say paid with nothing sent.
 */
export const bulkPayslipStatusSchema = bulkPayslipSchema.extend({
  status: z.enum(["draft", "issued"]),
});

export type BulkPayslipInput = z.infer<typeof bulkPayslipSchema>;
export type BulkPayslipStatusInput = z.infer<typeof bulkPayslipStatusSchema>;

export type CreatePayslipInput = z.infer<typeof createPayslipSchema>;
export type UpdatePayslipInput = z.infer<typeof updatePayslipSchema>;
