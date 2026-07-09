import { z } from "zod";

export const cardFormSchema = z.object({
  cardNumber: z.string().min(1, "Card number is required").max(40),
  name: z.string().min(1, "Name on card is required").max(120),
  client: z.string().min(1, "Client is required"),
  issueDate: z.string().optional(),
  expiryDate: z.string().optional(),
  notes: z.string().max(500).optional(),
});

export type CardFormValues = z.infer<typeof cardFormSchema>;
