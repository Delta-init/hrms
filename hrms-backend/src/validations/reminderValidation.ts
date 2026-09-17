import { z } from "zod";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const createReminderSchema = z.object({
  title: z.string().min(1, "Title is required").max(150),
  message: z.string().max(1000).optional(),
  audience: z.enum(["everyone", "team", "self"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  // Omitted (not just empty) means a date-only reminder — the evening-before
  // email instead of the 30/5/on-time cascade.
  time: z.string().regex(TIME_RE, "Must be in HH:mm format").optional(),
  timeZone: z.string().min(1).default("Asia/Dubai"),
});

export type CreateReminderInput = z.infer<typeof createReminderSchema>;
