import { z } from "zod";

export const regularizationFormSchema = z
  .object({
    user: z.string().min(1, "Employee is required"),
    date: z.string().min(1, "Date is required"),
    timeZone: z.string().min(1, "Time zone is required"),
    type: z.enum(["missing_checkin", "missing_checkout", "wrong_time", "absent_correction", "early_checkout"]),
    resultingStatus: z.enum(["present", "half_day", "wfh", "early_out"]),
    requestedCheckIn: z.string().optional(),
    requestedCheckOut: z.string().optional(),
    reason: z.string().max(500).optional(),
  })
  .refine((data) => !!data.requestedCheckIn || !!data.requestedCheckOut, {
    message: "Provide a corrected check-in and/or check-out time",
    path: ["requestedCheckIn"],
  })
  // Mirrors the backend's own check — a day still ahead has nothing settled
  // yet to correct at all. Today is allowed through here; whether it's
  // actually settled (already late or half day) is checked server-side,
  // against the day's own record.
  .refine(
    (data) => {
      if (!data.date || !data.timeZone) return true;
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: data.timeZone }).format(new Date());
      return data.date <= today;
    },
    { message: "You can't raise a correction for a day that hasn't happened yet", path: ["date"] }
  );

export type RegularizationFormValues = z.infer<typeof regularizationFormSchema>;
