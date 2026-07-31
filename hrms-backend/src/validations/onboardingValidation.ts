import { z } from "zod";

const CATEGORIES = ["documentation", "it_setup", "hr", "facilities", "training"] as const;
const ASSIGNEE_ROLES = ["hr", "it", "manager", "employee"] as const;
const TASK_STATUSES = ["pending", "completed"] as const;

const templateTaskSchema = z.object({
  title: z.string().min(1, "Title is required").max(150),
  description: z.string().max(500).optional(),
  category: z.enum(CATEGORIES).default("documentation"),
  assigneeRole: z.enum(ASSIGNEE_ROLES).default("hr"),
  dueDayOffset: z.coerce.number().int().min(-30).max(365).default(0),
});

export const createTemplateSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  description: z.string().max(500).optional(),
  tasks: z.array(templateTaskSchema).min(1, "Add at least one task"),
});

export const updateTemplateSchema = createTemplateSchema.partial();

export const createChecklistSchema = z.object({
  employee: z.string().min(1, "Employee is required"),
  templateId: z.string().min(1, "Template is required"),
});

export const updateTaskStatusSchema = z.object({
  status: z.enum(TASK_STATUSES),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type CreateChecklistInput = z.infer<typeof createChecklistSchema>;
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;
