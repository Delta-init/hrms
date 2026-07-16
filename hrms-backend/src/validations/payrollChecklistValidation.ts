import { z } from "zod";

export const createChecklistItemSchema = z.object({
  label: z.string().min(1, "Label is required").max(120),
  link: z.string().max(200).optional(),
  order: z.coerce.number().optional(),
});

export const updateChecklistItemSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  link: z.string().max(200).optional().nullable(),
  order: z.coerce.number().optional(),
});

export type CreateChecklistItemInput = z.infer<typeof createChecklistItemSchema>;
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;
