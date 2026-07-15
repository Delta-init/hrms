import { z } from "zod";

const resignationType = z.enum([
  "resignation",
  "termination",
  "retirement",
  "end_of_contract",
  "absconding",
]);

export const createResignationSchema = z.object({
  employee: z.string().min(1, "Employee is required"),
  resignationType: resignationType.optional(),
  resignationDate: z.coerce.date({ errorMap: () => ({ message: "Resignation date is required" }) }),
  noticeRequired: z.boolean().optional(),
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
  resignationType: resignationType.optional(),
  resignationDate: z.coerce.date().optional(),
  noticeRequired: z.boolean().optional(),
  noticePeriodDays: z.coerce.number().min(0).optional(),
  lastWorkingDay: z.coerce.date().optional().nullable(),
  reason: z.string().max(1000).optional().nullable(),
});

export const exitDetailsSchema = z.object({
  leavingDate: z.coerce.date().optional().nullable(),
  finalSettlement: z.coerce.number().min(0).optional().nullable(),
  left: z.boolean().optional(),
  noticePeriodServed: z.boolean().optional(),
  // Leave settlement
  leaveSalaryPaid: z.boolean().optional(),
  ticketAllowancePaid: z.boolean().optional(),
  paymentType: z.enum(["cash", "bank_transfer", "cheque"]).optional().nullable(),
  remarks: z.string().max(1000).optional().nullable(),
});

export type CreateResignationInput = z.infer<typeof createResignationSchema>;
export type ReviewResignationInput = z.infer<typeof reviewResignationSchema>;
export type UpdateResignationInput = z.infer<typeof updateResignationSchema>;
export type ExitDetailsInput = z.infer<typeof exitDetailsSchema>;
