import { z } from "zod";

export const createRosterAssignmentSchema = z
  .object({
    employee: z.string().min(1, "Employee is required"),
    workSchedule: z.string().min(1, "Work schedule is required"),
    effectiveFrom: z.coerce.date(),
    effectiveTo: z.coerce.date().optional().nullable(),
    notes: z.string().max(300).optional(),
  })
  .refine((d) => !d.effectiveTo || d.effectiveTo >= d.effectiveFrom, {
    message: "End date must be on or after the start date",
    path: ["effectiveTo"],
  });

export const updateRosterAssignmentSchema = z
  .object({
    workSchedule: z.string().min(1).optional(),
    effectiveFrom: z.coerce.date().optional(),
    effectiveTo: z.coerce.date().optional().nullable(),
    notes: z.string().max(300).optional(),
  })
  .refine((d) => !d.effectiveFrom || !d.effectiveTo || d.effectiveTo >= d.effectiveFrom, {
    message: "End date must be on or after the start date",
    path: ["effectiveTo"],
  });

export type CreateRosterAssignmentInput = z.infer<typeof createRosterAssignmentSchema>;
export type UpdateRosterAssignmentInput = z.infer<typeof updateRosterAssignmentSchema>;
