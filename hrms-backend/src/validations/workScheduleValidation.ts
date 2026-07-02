import { z } from "zod";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = z.string().regex(TIME_RE, "Must be in HH:mm format");

export const createWorkScheduleSchema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  description: z.string().max(300).optional(),
  timeZone: z.string().min(1).default("Asia/Dubai"),
  loginTime: time.default("09:00"),
  logoutTime: time.default("18:00"),
  workDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  halfDays: z.array(z.number().int().min(0).max(6)).default([]),
  graceMinutes: z.number().min(0).max(240).default(10),
  status: z.enum(["active", "inactive"]).default("active"),
});

export const updateWorkScheduleSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(300).optional().nullable(),
  timeZone: z.string().min(1).optional(),
  loginTime: time.optional(),
  logoutTime: time.optional(),
  workDays: z.array(z.number().int().min(0).max(6)).optional(),
  halfDays: z.array(z.number().int().min(0).max(6)).optional(),
  graceMinutes: z.number().min(0).max(240).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export type CreateWorkScheduleInput = z.infer<typeof createWorkScheduleSchema>;
export type UpdateWorkScheduleInput = z.infer<typeof updateWorkScheduleSchema>;
