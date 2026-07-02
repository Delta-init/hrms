import { z } from "zod";

const typeEnum = z.enum(["missing_checkin", "missing_checkout", "wrong_time", "absent_correction"]);
const statusEnum = z.enum(["pending", "approved", "rejected", "cancelled"]);

export const createRegularizationSchema = z.object({
  user: z.string().min(1, "User is required"),
  date: z.coerce.date({ errorMap: () => ({ message: "Valid date is required" }) }),
  timeZone: z.string().min(1).default("Asia/Dubai"),
  type: typeEnum,
  requestedCheckIn: z.coerce.date().optional().nullable(),
  requestedCheckOut: z.coerce.date().optional().nullable(),
  reason: z.string().max(500).optional(),
  status: statusEnum.optional(),
});

export const updateRegularizationSchema = z.object({
  date: z.coerce.date().optional(),
  timeZone: z.string().min(1).optional(),
  type: typeEnum.optional(),
  requestedCheckIn: z.coerce.date().optional().nullable(),
  requestedCheckOut: z.coerce.date().optional().nullable(),
  reason: z.string().max(500).optional().nullable(),
  status: statusEnum.optional(),
  reviewNote: z.string().max(500).optional().nullable(),
});

export type CreateRegularizationInput = z.infer<typeof createRegularizationSchema>;
export type UpdateRegularizationInput = z.infer<typeof updateRegularizationSchema>;
