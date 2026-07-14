import { z } from "zod";

const status = z.enum(["active", "closed", "cancelled"]);

export const createLoanSchema = z.object({
  employee: z.string().min(1, "Employee is required"),
  amount: z.coerce.number().min(0, "Amount cannot be negative"),
  purpose: z.string().max(200).optional(),
  disbursedDate: z.coerce.date().optional().nullable(),
  installments: z.coerce.number().min(1).optional(),
  monthlyDeduction: z.coerce.number().min(0).optional(),
  notes: z.string().max(500).optional(),
});

export const updateLoanSchema = z.object({
  amount: z.coerce.number().min(0).optional(),
  purpose: z.string().max(200).optional().nullable(),
  disbursedDate: z.coerce.date().optional().nullable(),
  installments: z.coerce.number().min(1).optional(),
  monthlyDeduction: z.coerce.number().min(0).optional(),
  amountRepaid: z.coerce.number().min(0).optional(),
  status: status.optional(),
  notes: z.string().max(500).optional().nullable(),
});

export type CreateLoanInput = z.infer<typeof createLoanSchema>;
export type UpdateLoanInput = z.infer<typeof updateLoanSchema>;
