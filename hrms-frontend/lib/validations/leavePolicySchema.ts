import { z } from "zod";

/** Types that already have a name; anything else has to bring its own label. */
export const BUILTIN_LEAVE_TYPES = [
  "annual", "sick", "casual", "unpaid", "maternity", "paternity", "wfh", "comp_off",
] as const;

export const leavePolicyFormSchema = z
  .object({
    type: z.string().trim().toLowerCase().min(1, "Leave type is required").max(40)
      .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers or underscores"),
    label: z.string().trim().max(60).optional(),
    /** "" means every employee in the organization. */
    workSchedule: z.string(),
    days: z.coerce.number().min(0, "Cannot be negative").max(366),
    period: z.enum(["month", "year"]),
    paid: z.boolean(),
    accrueMonthly: z.boolean(),
    carryForwardLimit: z.coerce.number().min(0, "Cannot be negative").max(366),
  })
  .superRefine((v, ctx) => {
    if (!BUILTIN_LEAVE_TYPES.includes(v.type as never) && !v.label?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["label"], message: "Give this leave type a name" });
    }
    // A month is granted whole and never rolls over — mirrors the server, which
    // rejects the same combination rather than silently ignoring it.
    if (v.period === "month" && v.days > 31) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["days"], message: "A month has at most 31 days" });
    }
  });

export type LeavePolicyFormValues = z.infer<typeof leavePolicyFormSchema>;
