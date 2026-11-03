import { z } from "zod";

export const grantCompOffSchema = z.object({
  employee: z.string().min(1, "Employee is required"),
  date: z.coerce.date(),
  amount: z.coerce.number().min(0.5, "Minimum 0.5 days").max(5, "Maximum 5 days"),
  reason: z.string().max(300).optional(),
});

export type GrantCompOffInput = z.infer<typeof grantCompOffSchema>;

/** An employee asking for a day back for a weekend or holiday they worked. */
export const requestCompOffSchema = z.object({
  date: z.coerce.date(),
  amount: z.coerce.number().refine((n) => n === 0.5 || n === 1, "Half a day or a full day"),
  reason: z.string().trim().min(3, "Say what you worked on").max(300),
});

export const approveCompOffSchema = z.object({
  amount: z.coerce.number().min(0.5, "Minimum 0.5 days").max(5, "Maximum 5 days").optional(),
  note: z.string().trim().max(300).optional(),
});

export const rejectCompOffSchema = z.object({
  note: z.string().trim().min(3, "Give a reason").max(300),
});

export const approveManyCompOffSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Pick at least one").max(500),
});

export type RequestCompOffInput = z.infer<typeof requestCompOffSchema>;
export type ApproveCompOffInput = z.infer<typeof approveCompOffSchema>;
