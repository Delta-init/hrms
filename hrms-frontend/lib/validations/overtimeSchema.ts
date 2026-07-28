import { z } from "zod";

export const overtimeFormSchema = z.object({
  employee: z.string().min(1, "Select an employee"),
  date: z.string().min(1, "Pick a date"),
  hours: z.coerce.number().min(0, "Cannot be negative").max(1000),
  hourlyRate: z.coerce.number().min(0, "Cannot be negative"),
  multiplier: z.coerce.number().min(1, "At least 1").max(10),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Pick a month"),
  notes: z.string().max(300).optional(),
});

export type OvertimeFormValues = z.infer<typeof overtimeFormSchema>;
