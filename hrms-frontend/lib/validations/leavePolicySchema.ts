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
    /**
     * Who the policy covers, as one value.
     *
     * "" is everyone; "mode:office" and "mode:wfh" are the two kinds of staff;
     * anything else is a work-schedule id. One field rather than two because
     * the targets are mutually exclusive — two dropdowns would let somebody
     * pick a combination the server rejects, and the form should not offer a
     * choice that cannot be saved.
     */
    target: z.string(),
    days: z.coerce.number().min(0, "Cannot be negative").max(366),
    period: z.enum(["month", "year"]),
    paid: z.boolean(),
    eligibleAfterMonths: z.coerce.number().int().min(0, "Cannot be negative").max(600),
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
