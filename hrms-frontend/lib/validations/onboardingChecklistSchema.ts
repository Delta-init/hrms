import { z } from "zod";

const CATEGORIES = ["documentation", "it_setup", "hr", "facilities", "training"] as const;
const ASSIGNEE_ROLES = ["hr", "it", "manager", "employee"] as const;

export const templateTaskFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(150),
  description: z.string().max(500).optional(),
  category: z.enum(CATEGORIES),
  assigneeRole: z.enum(ASSIGNEE_ROLES),
  dueDayOffset: z.coerce.number().int().min(-30).max(365),
});

export const templateFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  description: z.string().max(500).optional(),
  tasks: z.array(templateTaskFormSchema).min(1, "Add at least one task"),
});
export type TemplateFormValues = z.infer<typeof templateFormSchema>;

export const createChecklistFormSchema = z.object({
  employee: z.string().min(1, "Select an employee"),
  templateId: z.string().min(1, "Select a template"),
});
export type CreateChecklistFormValues = z.infer<typeof createChecklistFormSchema>;
