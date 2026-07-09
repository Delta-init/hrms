import { z } from "zod";

export const resignationFormSchema = z.object({
  employee: z.string().min(1, "Select an employee"),
  resignationDate: z.string().min(1, "Resignation date is required"),
  noticePeriodDays: z.coerce.number().min(0, "Cannot be negative"),
  lastWorkingDay: z.string().min(1, "Last working day is required"),
  reason: z.string().max(1000).optional(),
});

export type ResignationFormValues = z.infer<typeof resignationFormSchema>;
