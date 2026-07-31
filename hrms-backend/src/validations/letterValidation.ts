import { z } from "zod";

const CATEGORIES = ["offer", "appointment", "confirmation", "experience", "relieving", "warning", "other"] as const;

export const createLetterTemplateSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  category: z.enum(CATEGORIES).default("other"),
  subject: z.string().max(200).optional(),
  body: z.string().min(1, "Body is required").max(20000),
  status: z.enum(["active", "inactive"]).default("active"),
});

export const updateLetterTemplateSchema = createLetterTemplateSchema.partial();

export const generateLetterSchema = z.object({
  employee: z.string().min(1, "Employee is required"),
  templateId: z.string().min(1, "Template is required"),
  notes: z.string().max(300).optional(),
});

export const updateGeneratedLetterSchema = z.object({
  notes: z.string().max(300).optional(),
});

export type CreateLetterTemplateInput = z.infer<typeof createLetterTemplateSchema>;
export type UpdateLetterTemplateInput = z.infer<typeof updateLetterTemplateSchema>;
export type GenerateLetterInput = z.infer<typeof generateLetterSchema>;
export type UpdateGeneratedLetterInput = z.infer<typeof updateGeneratedLetterSchema>;
