import { z } from "zod";

const CATEGORIES = ["laptop", "phone", "monitor", "furniture", "vehicle", "sim_card", "other"] as const;
const CONDITIONS = ["new", "good", "fair", "poor", "damaged"] as const;

export const createAssetSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  category: z.enum(CATEGORIES).default("other"),
  assetTag: z.string().min(1, "Asset tag is required").max(40),
  serialNumber: z.string().max(80).optional(),
  purchaseDate: z.coerce.date().optional().nullable(),
  purchaseCost: z.coerce.number().min(0).optional(),
  condition: z.enum(CONDITIONS).default("new"),
  notes: z.string().max(500).optional(),
});

export const updateAssetSchema = createAssetSchema.partial();

export const issueAssetSchema = z.object({
  employee: z.string().min(1, "Employee is required"),
  condition: z.enum(CONDITIONS).optional(),
  notes: z.string().max(300).optional(),
});

export const returnAssetSchema = z.object({
  condition: z.enum(CONDITIONS),
  sendToMaintenance: z.boolean().optional(),
  notes: z.string().max(300).optional(),
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;
export type IssueAssetInput = z.infer<typeof issueAssetSchema>;
export type ReturnAssetInput = z.infer<typeof returnAssetSchema>;
