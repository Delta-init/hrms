import { z } from "zod";

const statusEnum = z.enum([
  "present",
  "absent",
  "late",
  "half_day",
  "on_leave",
  "holiday",
  "weekend",
  "wfh",
]);

export const createAttendanceSchema = z.object({
  user: z.string().min(1, "User is required"),
  date: z.coerce.date({ errorMap: () => ({ message: "Valid date is required" }) }),
  timeZone: z.string().min(1).default("Asia/Dubai"),
  checkIn: z.coerce.date().optional().nullable(),
  checkOut: z.coerce.date().optional().nullable(),
  status: statusEnum.default("present"),
  lateMinutes: z.number().min(0).optional(),
  note: z.string().max(500).optional(),
});

export const updateAttendanceSchema = z.object({
  date: z.coerce.date().optional(),
  timeZone: z.string().min(1).optional(),
  checkIn: z.coerce.date().optional().nullable(),
  checkOut: z.coerce.date().optional().nullable(),
  status: statusEnum.optional(),
  lateMinutes: z.number().min(0).optional(),
  note: z.string().max(500).optional().nullable(),
});

export type CreateAttendanceInput = z.infer<typeof createAttendanceSchema>;
export type UpdateAttendanceInput = z.infer<typeof updateAttendanceSchema>;
