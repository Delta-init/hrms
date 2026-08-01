import { z } from "zod";

const categoryEnum = z.enum(["it", "hr", "payroll", "facilities", "other"]);
const priorityEnum = z.enum(["low", "medium", "high"]);
const statusEnum = z.enum(["open", "in_progress", "resolved", "closed"]);

export const createTicketSchema = z.object({
  subject: z.string().min(1, "Subject is required").max(150),
  description: z.string().min(1, "Description is required").max(3000),
  category: categoryEnum.default("other"),
  priority: priorityEnum.default("medium"),
});

export const assignTicketSchema = z.object({
  assignedTo: z.string().min(1).nullable(),
});

export const setTicketStatusSchema = z.object({
  status: statusEnum,
});

export const addCommentSchema = z.object({
  body: z.string().min(1, "Comment cannot be empty").max(2000),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type AssignTicketInput = z.infer<typeof assignTicketSchema>;
export type SetTicketStatusInput = z.infer<typeof setTicketStatusSchema>;
export type AddCommentInput = z.infer<typeof addCommentSchema>;
