import { z } from "zod";

export const approvalWorkflowStepFormSchema = z.object({
  role: z.string().min(1, "Pick a role"),
  label: z.string().max(60).optional(),
});

export const approvalWorkflowFormSchema = z.object({
  enabled: z.boolean(),
  steps: z.array(approvalWorkflowStepFormSchema).max(5, "A workflow can have at most 5 steps"),
});

export type ApprovalWorkflowFormValues = z.infer<typeof approvalWorkflowFormSchema>;
