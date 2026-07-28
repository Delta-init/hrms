import { z } from "zod";

export const createOvertimeSchema = z.object({
  employee: z.string().min(1, "Employee is required"),
  date: z.coerce.date(),
  hours: z.coerce.number().min(0, "Hours cannot be negative").max(1000),
  hourlyRate: z.coerce.number().min(0, "Rate cannot be negative"),
  multiplier: z.coerce.number().min(1, "Multiplier must be at least 1").max(10).default(1.5),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Month must be YYYY-MM"),
  notes: z.string().max(300).optional(),
});

export const updateOvertimeSchema = createOvertimeSchema.omit({ employee: true }).partial();

export type CreateOvertimeInput = z.infer<typeof createOvertimeSchema>;
export type UpdateOvertimeInput = z.infer<typeof updateOvertimeSchema>;
