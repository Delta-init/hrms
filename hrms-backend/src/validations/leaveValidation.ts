import { z } from "zod";

const typeEnum = z.enum(["annual", "sick", "casual", "unpaid", "maternity", "paternity", "wfh", "comp_off"]);
const statusEnum = z.enum(["pending", "approved", "rejected", "cancelled"]);

export const createLeaveSchema = z.object({
  user: z.string().min(1, "User is required"),
  type: typeEnum,
  startDate: z.coerce.date({ errorMap: () => ({ message: "Valid start date is required" }) }),
  endDate: z.coerce.date({ errorMap: () => ({ message: "Valid end date is required" }) }),
  halfDay: z.boolean().default(false),
  timeZone: z.string().min(1).default("Asia/Dubai"),
  reason: z.string().max(500).optional(),
  status: statusEnum.optional(),
});

export const updateLeaveSchema = z.object({
  type: typeEnum.optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  halfDay: z.boolean().optional(),
  timeZone: z.string().min(1).optional(),
  reason: z.string().max(500).optional().nullable(),
  // No status/reviewNote here — approving is a distinct action gated on the
  // `approve` permission, via reviewLeaveSchema below.
});

export const reviewLeaveSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNote: z.string().max(500).optional().nullable(),
});

export type CreateLeaveInput = z.infer<typeof createLeaveSchema>;
export type UpdateLeaveInput = z.infer<typeof updateLeaveSchema>;
export type ReviewLeaveInput = z.infer<typeof reviewLeaveSchema>;
