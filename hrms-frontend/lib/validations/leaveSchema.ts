import { z } from "zod";

export const leaveFormSchema = z
  .object({
    user: z.string().min(1, "Employee is required"),
    type: z.enum(["annual", "sick", "casual", "unpaid", "maternity", "paternity", "wfh"]),
    startDate: z.string().min(1, "Start date is required"),
    endDate: z.string().min(1, "End date is required"),
    halfDay: z.boolean().default(false),
    timeZone: z.string().min(1, "Time zone is required"),
    reason: z.string().max(500).optional(),
  })
  .refine((d) => new Date(d.endDate) >= new Date(d.startDate), {
    message: "End date cannot be before start date",
    path: ["endDate"],
  });

export type LeaveFormValues = z.infer<typeof leaveFormSchema>;

export const holidayFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  date: z.string().min(1, "Date is required"),
  timeZone: z.string().min(1, "Time zone is required"),
  type: z.enum(["public", "company", "optional"]),
  recurring: z.boolean().default(false),
  workSchedule: z.string().optional(),
  description: z.string().max(300).optional(),
});

export type HolidayFormValues = z.infer<typeof holidayFormSchema>;
