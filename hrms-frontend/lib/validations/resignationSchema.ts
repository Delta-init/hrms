import { z } from "zod";

export const resignationFormSchema = z.object({
  employee: z.string().min(1, "Select an employee"),
  resignationType: z.enum(["resignation", "termination", "retirement", "end_of_contract", "absconding"]),
  resignationDate: z.string().min(1, "Resignation date is required"),
  noticeRequired: z.boolean(),
  noticePeriodDays: z.coerce.number().min(0, "Cannot be negative"),
  lastWorkingDay: z.string().min(1, "Last working day is required"),
  reason: z.string().max(1000).optional(),
});

export type ResignationFormValues = z.infer<typeof resignationFormSchema>;
