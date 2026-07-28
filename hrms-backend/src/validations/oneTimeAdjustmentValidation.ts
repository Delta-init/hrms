import { z } from "zod";

const kind = z.enum(["payment", "deduction"]);
const month = z.string().regex(/^\d{4}-\d{2}$/, "Month must be YYYY-MM");

export const createOneTimeSchema = z.object({
  employee: z.string().min(1, "Employee is required"),
  kind,
  label: z.string().min(1, "Label is required").max(80),
  amount: z.coerce.number().min(0, "Amount cannot be negative"),
  month,
  notes: z.string().max(300).optional(),
});

export const updateOneTimeSchema = z.object({
  kind: kind.optional(),
  label: z.string().min(1).max(80).optional(),
  amount: z.coerce.number().min(0).optional(),
  month: month.optional(),
  notes: z.string().max(300).optional().nullable(),
});

export type CreateOneTimeInput = z.infer<typeof createOneTimeSchema>;
export type UpdateOneTimeInput = z.infer<typeof updateOneTimeSchema>;
