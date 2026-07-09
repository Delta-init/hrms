import { z } from "zod";

export const createResignationSchema = z.object({
  employee: z.string().min(1, "Employee is required"),
  resignationDate: z.coerce.date({ errorMap: () => ({ message: "Resignation date is required" }) }),
  noticePeriodDays: z.coerce.number().min(0).optional(),
  lastWorkingDay: z.coerce.date().optional().nullable(),
  reason: z.string().max(1000).optional(),
});

export const reviewResignationSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
  noticePeriodDays: z.coerce.number().min(0).optional(),
  lastWorkingDay: z.coerce.date().optional().nullable(),
  reviewNote: z.string().max(500).optional(),
});

export const updateResignationSchema = z.object({
  resignationDate: z.coerce.date().optional(),
  noticePeriodDays: z.coerce.number().min(0).optional(),
  lastWorkingDay: z.coerce.date().optional().nullable(),
  reason: z.string().max(1000).optional().nullable(),
});

export type CreateResignationInput = z.infer<typeof createResignationSchema>;
export type ReviewResignationInput = z.infer<typeof reviewResignationSchema>;
export type UpdateResignationInput = z.infer<typeof updateResignationSchema>;
