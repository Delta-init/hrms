import { z } from "zod";

export const offerTemplateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().min(1, "Body is required").max(10000),
  status: z.enum(["active", "inactive"]).optional(),
});
export const updateOfferTemplateSchema = offerTemplateSchema.partial();

export const offerPreviewSchema = z.object({
  emailTemplate: z.string().optional().nullable(),
  letterTemplate: z.string().optional().nullable(),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").optional().nullable(),
});

export const sendOfferSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required").max(200),
  body: z.string().min(1, "Write the email").max(10000),
  letterSubject: z.string().trim().max(200).optional().default(""),
  letterBody: z.string().max(20000).optional().default(""),
});
