import { z } from "zod";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const reminderFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(150),
  message: z.string().max(1000).optional(),
  audience: z.enum(["everyone", "team", "self"]),
  date: z.string().min(1, "Date is required"),
  // Empty string (not sent) means a date-only reminder.
  time: z.string().regex(TIME_RE, "Must be in HH:mm format").optional().or(z.literal("")),
  timeZone: z.string().min(1),
});

export type ReminderFormValues = z.infer<typeof reminderFormSchema>;
