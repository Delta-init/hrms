import { z } from "zod";

export const procurementFormSchema = z.object({
  item: z.string().min(1, "Item is required").max(160),
  category: z.string().max(40).optional(),
  quantity: z.coerce.number().int().min(1, "At least one"),
  estimatedCost: z.coerce.number().min(0).optional(),
  vendor: z.string().max(120).optional(),
  department: z.string().optional(),
  neededBy: z.string().optional(),
  justification: z.string().max(1000).optional(),
  status: z.enum(["requested", "ordered", "received", "cancelled"]),
  notes: z.string().max(500).optional(),
});

export type ProcurementFormValues = z.infer<typeof procurementFormSchema>;
