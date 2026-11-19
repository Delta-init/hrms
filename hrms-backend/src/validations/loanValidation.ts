import { z } from "zod";

const status = z.enum(["active", "closed", "cancelled"]);

// `monthlyDeduction` is deliberately absent from both schemas below: it is
// always derived from `amount`/`installments` in the service layer, never
// accepted from the client, so it can no longer be submitted stale.

export const createLoanSchema = z.object({
  employee: z.string().min(1, "Employee is required"),
  amount: z.coerce.number().min(0, "Amount cannot be negative"),
  purpose: z.string().max(200).optional(),
  disbursedDate: z.coerce.date().optional().nullable(),
  installments: z.coerce.number().min(1).optional(),
  notes: z.string().max(500).optional(),
});

export const updateLoanSchema = z.object({
  amount: z.coerce.number().min(0).optional(),
  purpose: z.string().max(200).optional().nullable(),
  disbursedDate: z.coerce.date().optional().nullable(),
  installments: z.coerce.number().min(1).optional(),
  amountRepaid: z.coerce.number().min(0).optional(),
  status: status.optional(),
  notes: z.string().max(500).optional().nullable(),
});

export const monthParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM");

/** Skip a month (0) or take less in it. */
export const planMonthSchema = z.object({
  amount: z.coerce.number().min(0, "Amount cannot be negative"),
  reason: z.string().trim().max(300).optional(),
});

/** Money repaid outside payroll. */
export const directPaymentSchema = z.object({
  amount: z.coerce.number().positive("Enter the amount paid"),
  date: z.coerce.date(),
  method: z.enum(["cash", "bank_transfer", "cheque", "other"]).default("cash"),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(300).optional(),
});

export type CreateLoanInput = z.infer<typeof createLoanSchema>;
export type UpdateLoanInput = z.infer<typeof updateLoanSchema>;
export type PlanMonthInput = z.infer<typeof planMonthSchema>;
export type DirectPaymentInput = z.infer<typeof directPaymentSchema>;
