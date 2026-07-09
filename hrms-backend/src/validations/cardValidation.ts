import { z } from "zod";

export const createCardSchema = z.object({
  cardNumber: z.string().min(1, "Card number is required").max(40),
  name: z.string().min(1, "Name on card is required").max(120),
  client: z.string().min(1, "Client is required"),
  issueDate: z.coerce.date().optional().nullable(),
  expiryDate: z.coerce.date().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const updateCardSchema = z.object({
  cardNumber: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(120).optional(),
  client: z.string().min(1).optional(),
  issueDate: z.coerce.date().optional().nullable(),
  expiryDate: z.coerce.date().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export type CreateCardInput = z.infer<typeof createCardSchema>;
export type UpdateCardInput = z.infer<typeof updateCardSchema>;
