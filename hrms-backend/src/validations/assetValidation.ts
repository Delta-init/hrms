import { z } from "zod";

const CONDITIONS = ["new", "good", "fair", "poor", "damaged"] as const;

/**
 * Categories are open, not a fixed list.
 *
 * The register that was migrated in carries twenty-odd kinds of thing — mice,
 * headphones, clocks, uniforms, first-aid boxes — and a new one turns up
 * whenever the business buys something it has not bought before. The seven-value
 * enum this used to be meant the import wrote categories the API then refused to
 * accept back, so editing any of those assets failed on a field the editor could
 * not even see. Whatever arrives is normalised to a slug; the labels live in the
 * frontend, which is where display belongs, and falls back to a readable version
 * of the slug for anything it has not been taught yet.
 */
const category = z
  .string()
  .trim()
  .max(40)
  .transform((v) => v.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "other");

export const createAssetSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  category: category.default("other"),
  assetTag: z.string().min(1, "Asset tag is required").max(40),
  serialNumber: z.string().max(80).optional(),
  purchaseDate: z.coerce.date().optional().nullable(),
  purchaseCost: z.coerce.number().min(0).optional(),
  condition: z.enum(CONDITIONS).default("new"),
  // Where the thing physically is, and how many of it this record stands for.
  // Bulk stock — chairs, uniforms — is counted rather than tagged one by one.
  branch: z.string().max(60).optional(),
  location: z.string().max(80).optional(),
  quantity: z.coerce.number().int().min(1).optional(),
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
