import { z } from "zod";

const month = z.string().regex(/^\d{4}-\d{2}$/, "Month must be YYYY-MM");

export const createSalaryAdvanceSchema = z.object({
  amount: z.coerce.number().positive("Enter the amount you need").max(10_000_000),
  reason: z.string().trim().min(1, "Say what it's for").max(500),
  neededBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").optional().nullable(),
});

/** HR's half. Approving names how it is recovered; refusing needs only a note. */
export const reviewSalaryAdvanceSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    months: z.coerce.number().int().min(1, "At least one month").max(12, "At most 12 months").optional(),
    startMonth: month.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.decision === "reject" || (v.months && v.startMonth), {
    message: "Choose how many months, and from which month, to recover it",
    path: ["months"],
  });

/** HR raising one for an employee: HR's own approval comes with it. */
export const createAdvanceForEmployeeSchema = z.object({
  employee: z.string().regex(/^[a-f\d]{24}$/i, "Choose an employee"),
  amount: z.coerce.number().positive("Enter the amount").max(10_000_000),
  reason: z.string().trim().min(1, "Say what it's for").max(500),
  neededBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD").optional().nullable(),
  months: z.coerce.number().int().min(1, "At least one month").max(12, "At most 12 months"),
  startMonth: month,
  note: z.string().trim().max(500).optional(),
});

export type CreateAdvanceForEmployeeInput = z.infer<typeof createAdvanceForEmployeeSchema>;
export type CreateSalaryAdvanceInput = z.infer<typeof createSalaryAdvanceSchema>;
export type ReviewSalaryAdvanceInput = z.infer<typeof reviewSalaryAdvanceSchema>;
