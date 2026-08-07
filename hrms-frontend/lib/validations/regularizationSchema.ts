import { z } from "zod";

export const regularizationFormSchema = z
  .object({
    user: z.string().min(1, "Employee is required"),
    date: z.string().min(1, "Date is required"),
    timeZone: z.string().min(1, "Time zone is required"),
    type: z.enum(["missing_checkin", "missing_checkout", "wrong_time", "absent_correction"]),
    resultingStatus: z.enum(["present", "half_day", "wfh"]),
    requestedCheckIn: z.string().optional(),
    requestedCheckOut: z.string().optional(),
    reason: z.string().max(500).optional(),
  })
  .refine((data) => !!data.requestedCheckIn || !!data.requestedCheckOut, {
    message: "Provide a corrected check-in and/or check-out time",
    path: ["requestedCheckIn"],
  });

export type RegularizationFormValues = z.infer<typeof regularizationFormSchema>;
