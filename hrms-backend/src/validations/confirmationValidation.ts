import { z } from "zod";

export const initiateConfirmationSchema = z.object({
  employee: z.string().min(1, "Employee is required"),
  confirmationDate: z.coerce.date({ errorMap: () => ({ message: "Confirmation date is required" }) }),
  notes: z.string().max(1000).optional().nullable(),
  /** Route through the configured approval chain instead of confirming outright. */
  useWorkflow: z.boolean().optional(),
});

export const reviewConfirmationSchema = z.object({
  status: z.enum(["confirmed", "rejected"]),
  reviewNote: z.string().max(500).optional().nullable(),
});

export type InitiateConfirmationInput = z.infer<typeof initiateConfirmationSchema>;
export type ReviewConfirmationInput = z.infer<typeof reviewConfirmationSchema>;
