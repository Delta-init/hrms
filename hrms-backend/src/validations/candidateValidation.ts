import { z } from "zod";
import { APPLICATION_STAGES } from "../types/index.js";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

const candidateBase = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("A valid email is required").max(160),
  phone: z.string().trim().max(40).optional(),
  source: z.string().trim().max(60).optional(),
  currentCompany: z.string().trim().max(120).optional(),
  currentDesignation: z.string().trim().max(120).optional(),
  totalExperienceYears: z.coerce.number().min(0).max(60).optional(),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
  expectedSalary: z.coerce.number().min(0).optional(),
  currency: z.string().trim().toUpperCase().length(3).default("AED"),
  location: z.string().trim().max(80).optional(),
  links: z.array(z.string().trim().url("Each link must be a URL")).max(10).default([]),
  notes: z.string().trim().max(2000).optional(),
});

export const createCandidateSchema = candidateBase;
export const updateCandidateSchema = candidateBase.partial().omit({ email: true });

export const applySchema = z.object({
  requisition: objectId,
  candidate: objectId,
  stage: z.enum(APPLICATION_STAGES).optional(),
});

export const moveStageSchema = z
  .object({
    stage: z.enum(APPLICATION_STAGES).optional(),
    status: z.enum(["active", "waitlisted", "rejected", "withdrawn"]).optional(),
    rating: z.coerce.number().int().min(1).max(5).nullish(),
    offeredSalary: z.coerce.number().min(0).nullish(),
    reason: z.string().trim().max(500).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.stage && !v.status && v.rating === undefined && v.offeredSalary === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Nothing to change" });
    }
    // Without one, a rejection six months later is a dead end nobody can explain.
    if (v.status === "rejected" && !v.reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Say why they were rejected" });
    }
    // A waitlist entry with no note is indistinguishable from being forgotten.
    if (v.status === "waitlisted" && !v.reason && !v.note) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "Say why they are being waitlisted" });
    }
  });

export type CreateCandidateInput = z.infer<typeof createCandidateSchema>;
export type UpdateCandidateInput = z.infer<typeof updateCandidateSchema>;
export type ApplyInput = z.infer<typeof applySchema>;
export type MoveStageInput = z.infer<typeof moveStageSchema>;

export const decideOfferSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(500).optional(),
});
export type DecideOfferInput = z.infer<typeof decideOfferSchema>;
