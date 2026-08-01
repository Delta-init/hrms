import { z } from "zod";

const categoryEnum = z.enum(["general", "policy", "event", "celebration"]);

export const createAnnouncementSchema = z.object({
  title: z.string().min(1, "Title is required").max(150),
  body: z.string().min(1, "Body is required").max(3000),
  category: categoryEnum.default("general"),
  pinned: z.boolean().default(false),
});

export const updateAnnouncementSchema = z.object({
  title: z.string().min(1).max(150).optional(),
  body: z.string().min(1).max(3000).optional(),
  category: categoryEnum.optional(),
  pinned: z.boolean().optional(),
});

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
