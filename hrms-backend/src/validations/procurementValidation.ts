import { z } from "zod";

const kind = z.enum(["existing", "new"]);
const status = z.enum(["requested", "hr_approved", "approved", "rejected", "ordered", "received", "cancelled"]);

const fields = {
  kind: kind.optional(),
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
};

export const createProcurementSchema = z.object(fields);

export const updateProcurementSchema = z.object({
  ...fields,
  item: z.string().min(1).max(160).optional(),
  quantity: z.coerce.number().int().min(1).optional(),
  estimatedCost: z.coerce.number().min(0).optional(),
  category: z.string().max(40).optional().nullable(),
});

/** HR's decision on a `new` request. */
export const reviewProcurementSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(500).optional().nullable(),
});

/**
 * Revising a rejected request.
 *
 * The editable fields only — a resubmission may not quietly change what kind of
 * record it is, and the status is decided here rather than sent by the caller.
 */
export const resubmitProcurementSchema = z.object({
  item: z.string().min(1).max(160).optional(),
  category: z.string().max(40).optional().nullable(),
  quantity: z.coerce.number().int().min(1).optional(),
  estimatedCost: z.coerce.number().min(0).optional(),
  vendor: z.string().max(120).optional().nullable(),
  department: z.string().optional().nullable(),
  neededBy: z.coerce.date().optional().nullable(),
  justification: z.string().max(1000).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export type CreateProcurementInput = z.infer<typeof createProcurementSchema>;
export type UpdateProcurementInput = z.infer<typeof updateProcurementSchema>;
export type ReviewProcurementInput = z.infer<typeof reviewProcurementSchema>;
export type ResubmitProcurementInput = z.infer<typeof resubmitProcurementSchema>;
