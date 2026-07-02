import { z } from "zod";

export const regularizationFormSchema = z.object({
  user: z.string().min(1, "Employee is required"),
  date: z.string().min(1, "Date is required"),
  timeZone: z.string().min(1, "Time zone is required"),
  type: z.enum(["missing_checkin", "missing_checkout", "wrong_time", "absent_correction"]),
  requestedCheckIn: z.string().optional(),
  requestedCheckOut: z.string().optional(),
  reason: z.string().max(500).optional(),
});

export type RegularizationFormValues = z.infer<typeof regularizationFormSchema>;
