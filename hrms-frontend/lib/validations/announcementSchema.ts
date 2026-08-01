import { z } from "zod";

export const announcementFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(150),
  body: z.string().min(1, "Body is required").max(3000),
  category: z.enum(["general", "policy", "event", "celebration"]).default("general"),
  pinned: z.boolean().default(false),
});

export type AnnouncementFormValues = z.infer<typeof announcementFormSchema>;
