import { z } from "zod";

export const createOfficeKeepingSchema = z.object({
  issue: z.string().min(1, "Tell us what needs doing").max(1000),
  location: z.string().min(1, "Where is it?").max(160),
  notes: z.string().max(500).optional().nullable(),
});

/**
 * Moving a request along. `requested` is not offered: a request is born there
 * and putting it back would erase the fact somebody had already set off.
 */
export const updateStatusSchema = z.object({
  status: z.enum(["arriving", "sorted", "cancelled"]),
  note: z.string().max(300).optional().nullable(),
});

export type CreateOfficeKeepingInput = z.infer<typeof createOfficeKeepingSchema>;
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
