import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
const month = z.string().regex(/^\d{4}-\d{2}$/, "Month must be YYYY-MM");

export const createDeductionRemovalSchema = z.object({
  sourceType: z.enum(["loan", "adjustment"]),
  sourceId: objectId,
  month,
  reason: z.string().trim().min(1, "Say why you're asking").max(500),
});

export const reviewDeductionRemovalSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNote: z.string().trim().max(500).optional(),
});

export type CreateDeductionRemovalInput = z.infer<typeof createDeductionRemovalSchema>;
export type ReviewDeductionRemovalInput = z.infer<typeof reviewDeductionRemovalSchema>;
