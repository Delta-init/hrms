import { z } from "zod";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const workScheduleFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  description: z.string().max(300).optional(),
  timeZone: z.string().min(1, "Region is required"),
  loginTime: z.string().regex(TIME_RE, "Use HH:mm"),
  logoutTime: z.string().regex(TIME_RE, "Use HH:mm"),
  workDays: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one work day"),
  halfDays: z.array(z.number().int().min(0).max(6)).default([]),
  graceMinutes: z.coerce.number().min(0).max(240),
  status: z.enum(["active", "inactive"]),
});

export type WorkScheduleFormValues = z.infer<typeof workScheduleFormSchema>;
