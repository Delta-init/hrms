import { z } from "zod";

const CATEGORIES = ["offer", "appointment", "confirmation", "experience", "relieving", "warning", "other"] as const;

export const letterTemplateFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  category: z.enum(CATEGORIES),
  subject: z.string().max(200).optional(),
  body: z.string().min(1, "Body is required").max(20000),
  status: z.enum(["active", "inactive"]),
});
export type LetterTemplateFormValues = z.infer<typeof letterTemplateFormSchema>;

export const generateLetterFormSchema = z.object({
  employee: z.string().min(1, "Select an employee"),
  templateId: z.string().min(1, "Select a template"),
  notes: z.string().max(300).optional(),
});
export type GenerateLetterFormValues = z.infer<typeof generateLetterFormSchema>;
