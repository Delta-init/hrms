import { z } from "zod";

const statusEnum = z.enum([
  "present", "absent", "late", "half_day", "on_leave", "holiday", "weekend", "wfh",
]);

export const attendanceFormSchema = z.object({
  user: z.string().min(1, "Employee is required"),
  date: z.string().min(1, "Date is required"),
  timeZone: z.string().min(1, "Time zone is required"),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  status: statusEnum,
  lateMinutes: z.coerce.number().min(0).optional(),
  note: z.string().max(500).optional(),
});

export type AttendanceFormValues = z.infer<typeof attendanceFormSchema>;
