import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

const base = z.object({
  type: z.enum(["replacement", "new_headcount"]),
  replacing: objectId.nullish(),
  title: z.string().trim().min(1, "Give the role a title").max(120),
  department: objectId.nullish(),
  designation: z.string().trim().max(120).optional(),
  location: z.enum(["india", "dubai"]).optional(),
  employmentType: z.enum(["full_time", "part_time", "contract", "intern"]).default("full_time"),
  headcount: z.coerce.number().int().min(1, "At least one").max(999).default(1),
  salaryMin: z.coerce.number().min(0).optional(),
  salaryMax: z.coerce.number().min(0).optional(),
  currency: z.string().trim().toUpperCase().length(3).default("AED"),
  justification: z.string().trim().max(2000).optional(),
  targetStartDate: z.coerce.date().nullish(),
  status: z.enum(["draft", "pending"]).optional(),
});

export const createRequisitionSchema = base.superRefine((v, ctx) => {
  // Without it there is nothing to compare the proposed salary against, and the
  // budget step would silently never apply.
  if (v.type === "replacement" && !v.replacing) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["replacing"], message: "Say who is being replaced" });
  }
  if (v.salaryMin != null && v.salaryMax != null && v.salaryMin > v.salaryMax) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["salaryMax"], message: "Maximum cannot be below the minimum" });
  }
});

export const updateRequisitionSchema = base.partial().superRefine((v, ctx) => {
  if (v.salaryMin != null && v.salaryMax != null && v.salaryMin > v.salaryMax) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["salaryMax"], message: "Maximum cannot be below the minimum" });
  }
});

export const reviewRequisitionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNote: z.string().trim().max(1000).nullish(),
});

export type CreateRequisitionInput = z.infer<typeof createRequisitionSchema>;
export type UpdateRequisitionInput = z.infer<typeof updateRequisitionSchema>;
export type ReviewRequisitionInput = z.infer<typeof reviewRequisitionSchema>;
