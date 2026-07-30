import { z } from "zod";

const CATEGORIES = ["laptop", "phone", "monitor", "furniture", "vehicle", "sim_card", "other"] as const;
const CONDITIONS = ["new", "good", "fair", "poor", "damaged"] as const;

export const assetFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  category: z.enum(CATEGORIES),
  assetTag: z.string().min(1, "Asset tag is required").max(40),
  serialNumber: z.string().max(80).optional(),
  purchaseDate: z.string().optional(),
  purchaseCost: z.coerce.number().min(0).optional(),
  condition: z.enum(CONDITIONS),
  notes: z.string().max(500).optional(),
});
export type AssetFormValues = z.infer<typeof assetFormSchema>;

export const issueAssetFormSchema = z.object({
  employee: z.string().min(1, "Select an employee"),
  condition: z.enum(CONDITIONS).optional(),
  notes: z.string().max(300).optional(),
});
export type IssueAssetFormValues = z.infer<typeof issueAssetFormSchema>;

export const returnAssetFormSchema = z.object({
  condition: z.enum(CONDITIONS),
  sendToMaintenance: z.boolean().optional(),
  notes: z.string().max(300).optional(),
});
export type ReturnAssetFormValues = z.infer<typeof returnAssetFormSchema>;
