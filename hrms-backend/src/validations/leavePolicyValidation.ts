import { z } from "zod";

/** Types that already have a name; anything else has to bring its own label. */
export const BUILTIN_LEAVE_TYPES = [
  "annual", "sick", "casual", "unpaid", "maternity", "paternity", "wfh", "comp_off",
] as const;

export const createLeavePolicySchema = z
  .object({
    /** Open slug so an organization can name leave the built-in set misses. */
    type: z.string().trim().toLowerCase().min(1).max(40)
      .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers or underscores"),
    label: z.string().trim().max(60).optional(),
    /** Empty means the organization-wide policy, same as omitting it. */
    workSchedule: z.string().trim().min(1).nullish().transform((v) => v ?? null),
    days: z.coerce.number().min(0, "Cannot be negative").max(366),
    period: z.enum(["month", "year"]).default("year"),
    paid: z.boolean().default(true),
    eligibleAfterMonths: z.coerce.number().int().min(0, "Cannot be negative").max(600).default(0),
    carryForwardLimit: z.coerce.number().min(0, "Cannot be negative").max(366).default(0),
  })
  .superRefine((v, ctx) => {
    if (!BUILTIN_LEAVE_TYPES.includes(v.type as never) && !v.label?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["label"], message: "Give this leave type a name" });
    }
    // A month is granted whole and never rolls over, so these two would be
    // silently ignored rather than doing what the form appears to promise.
    if (v.period === "month" && v.carryForwardLimit > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["carryForwardLimit"], message: "Monthly leave cannot carry forward" });
    }
    if (v.period === "month" && v.days > 31) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["days"], message: "A month has at most 31 days" });
    }
  });

export const updateLeavePolicySchema = z
  .object({
    label: z.string().trim().max(60).optional(),
    workSchedule: z.string().trim().min(1).nullish().transform((v) => v ?? null),
    days: z.coerce.number().min(0, "Cannot be negative").max(366),
    period: z.enum(["month", "year"]),
    paid: z.boolean(),
    eligibleAfterMonths: z.coerce.number().int().min(0, "Cannot be negative").max(600),
    carryForwardLimit: z.coerce.number().min(0, "Cannot be negative").max(366),
  })
  .partial()
  .superRefine((v, ctx) => {
    if (v.period === "month" && (v.carryForwardLimit ?? 0) > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["carryForwardLimit"], message: "Monthly leave cannot carry forward" });
    }
    if (v.period === "month" && (v.days ?? 0) > 31) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["days"], message: "A month has at most 31 days" });
    }
  });

export type CreateLeavePolicyInput = z.infer<typeof createLeavePolicySchema>;
export type UpdateLeavePolicyInput = z.infer<typeof updateLeavePolicySchema>;
