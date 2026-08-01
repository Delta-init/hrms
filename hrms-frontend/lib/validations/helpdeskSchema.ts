import { z } from "zod";

export const ticketFormSchema = z.object({
  subject: z.string().min(1, "Subject is required").max(150),
  description: z.string().min(1, "Description is required").max(3000),
  category: z.enum(["it", "hr", "payroll", "facilities", "other"]).default("other"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});
export type TicketFormValues = z.infer<typeof ticketFormSchema>;
