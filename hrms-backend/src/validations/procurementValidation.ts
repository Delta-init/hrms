import { z } from "zod";

const status = z.enum(["requested", "ordered", "received", "cancelled"]);

export const createProcurementSchema = z.object({
  item: z.string().min(1, "Item is required").max(160),
  category: z.string().max(40).optional(),
  quantity: z.coerce.number().int().min(1).default(1),
  estimatedCost: z.coerce.number().min(0).default(0),
  currency: z.string().max(6).optional(),
  vendor: z.string().max(120).optional().nullable(),
  department: z.string().optional().nullable(),
  neededBy: z.coerce.date().optional().nullable(),
  justification: z.string().max(1000).optional().nullable(),
  status: status.optional(),
  notes: z.string().max(500).optional().nullable(),
});

export const updateProcurementSchema = z.object({
  item: z.string().min(1).max(160).optional(),
  category: z.string().max(40).optional().nullable(),
  quantity: z.coerce.number().int().min(1).optional(),
  estimatedCost: z.coerce.number().min(0).optional(),
  currency: z.string().max(6).optional(),
  vendor: z.string().max(120).optional().nullable(),
  department: z.string().optional().nullable(),
  neededBy: z.coerce.date().optional().nullable(),
  justification: z.string().max(1000).optional().nullable(),
  status: status.optional(),
  notes: z.string().max(500).optional().nullable(),
});

export type CreateProcurementInput = z.infer<typeof createProcurementSchema>;
export type UpdateProcurementInput = z.infer<typeof updateProcurementSchema>;
