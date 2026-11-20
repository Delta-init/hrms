import { z } from "zod";

const CONDITIONS = ["new", "good", "fair", "poor", "damaged"] as const;

export const assetFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  // Open text, normalised to a slug server-side: the register grows a new
  // category whenever the business buys something it has not bought before.
  category: z.string().min(1, "Category is required").max(40),
  assetTag: z.string().min(1, "Asset tag is required").max(40),
  serialNumber: z.string().max(80).optional(),
  purchaseDate: z.string().optional(),
  purchaseCost: z.coerce.number().min(0).optional(),
  condition: z.enum(CONDITIONS),
  branch: z.string().max(60).optional(),
  location: z.string().max(80).optional(),
  quantity: z.coerce.number().int().min(1).optional(),
  notes: z.string().max(500).optional(),
});
export type AssetFormValues = z.infer<typeof assetFormSchema>;

/** To a person or to a department; `to` says which picker the holder came from. */
export const issueAssetFormSchema = z
  .object({
    to: z.enum(["person", "department"]),
    holder: z.string(),
    condition: z.enum(CONDITIONS).optional(),
    notes: z.string().max(300).optional(),
  })
  .refine((v) => !!v.holder, {
    path: ["holder"],
    message: "Choose who gets it",
  });
export type IssueAssetFormValues = z.infer<typeof issueAssetFormSchema>;

export const returnAssetFormSchema = z.object({
  condition: z.enum(CONDITIONS),
  sendToMaintenance: z.boolean().optional(),
  notes: z.string().max(300).optional(),
});
export type ReturnAssetFormValues = z.infer<typeof returnAssetFormSchema>;
