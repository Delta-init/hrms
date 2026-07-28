import { z } from "zod";

const CATEGORIES = ["travel", "food", "accommodation", "medical", "communication", "fuel", "supplies", "other"] as const;

export const createReimbursementSchema = z.object({
  employee: z.string().optional(),
  category: z.enum(CATEGORIES).default("other"),
  title: z.string().min(1, "Title is required").max(120),
  amount: z.coerce.number().min(0, "Amount cannot be negative"),
  expenseDate: z.coerce.date(),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Month must be YYYY-MM"),
  description: z.string().max(500).optional(),
  receiptUrl: z.string().max(500).optional(),
});

export const updateReimbursementSchema = createReimbursementSchema
  .omit({ employee: true })
  .partial();

export const reviewReimbursementSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNote: z.string().max(500).optional().nullable(),
});

export type CreateReimbursementInput = z.infer<typeof createReimbursementSchema>;
export type UpdateReimbursementInput = z.infer<typeof updateReimbursementSchema>;
export type ReviewReimbursementInput = z.infer<typeof reviewReimbursementSchema>;
