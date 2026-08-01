import { z } from "zod";

export const moduleEnum = z.enum(["leave", "regularization", "reimbursements"]);

const stepSchema = z.object({
  role: z.string().min(1, "Role is required"),
  label: z.string().max(60).optional(),
});

export const upsertApprovalWorkflowSchema = z.object({
  enabled: z.boolean().default(false),
  steps: z.array(stepSchema).max(5, "A workflow can have at most 5 steps"),
});

export type UpsertApprovalWorkflowInput = z.infer<typeof upsertApprovalWorkflowSchema>;
