import { z } from "zod";

export const rosterFormSchema = z
  .object({
    employee: z.string().min(1, "Select an employee"),
    workSchedule: z.string().min(1, "Select a work schedule"),
    effectiveFrom: z.string().min(1, "Start date is required"),
    effectiveTo: z.string().optional(),
    notes: z.string().max(300).optional(),
  })
  .refine((d) => !d.effectiveTo || d.effectiveTo >= d.effectiveFrom, {
    message: "End date must be on or after the start date",
    path: ["effectiveTo"],
  });

export type RosterFormValues = z.infer<typeof rosterFormSchema>;
