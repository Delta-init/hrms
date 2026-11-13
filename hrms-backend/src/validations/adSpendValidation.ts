import { z } from "zod";
import { isDayKey, isMonday } from "../utils/adSpend.js";

const money = z.coerce
  .number({ invalid_type_error: "Enter a number" })
  .min(0, "Cannot be negative")
  .max(10_000_000, "That is more than one week's ads could cost");

/**
 * A week as the recruiter saves it. `total` is not accepted: it is worked out
 * from the amounts, so it can never disagree with them.
 */
export const saveWeekSchema = z
  .object({
    nothingSpent: z.boolean().default(false),
    note: z.string().trim().max(1000).optional().default(""),
    lines: z
      .array(
        z.object({
          requisition: z.string().regex(/^[a-f0-9]{24}$/i, "Not a hiring request").nullish(),
          role: z.string().trim().min(1, "Name the role").max(150),
          amounts: z.array(z.object({ platform: z.string().trim().min(1).max(40), amount: money })).max(30),
          note: z.string().trim().max(300).optional().default(""),
        })
      )
      .max(100, "A week can hold up to 100 roles")
      .default([]),
  })
  .superRefine((v, ctx) => {
    const spent = v.lines.some((l) => l.amounts.some((a) => a.amount > 0));
    if (v.nothingSpent && spent) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nothingSpent"], message: "Amounts are entered — untick “Nothing spent”, or clear them" });
    }
    if (!v.nothingSpent && !spent) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["lines"], message: "Enter what was spent, or tick “Nothing spent this week”" });
    }
  });

export const updateSettingsSchema = z.object({
  currency: z.string().trim().length(3, "A three-letter currency code").toUpperCase().optional(),
  monthlyBudget: z.coerce.number().min(0, "Cannot be negative").max(100_000_000).optional(),
  platforms: z
    .array(
      z.object({
        key: z.string().trim().max(40).optional(),
        label: z.string().trim().min(1, "Name the platform").max(40),
        active: z.boolean().default(true),
      })
    )
    .max(30)
    .optional(),
  trackingFrom: z
    .string()
    .refine(isDayKey, "Not a date")
    .refine(isMonday, "Pick a Monday — weeks run Monday to Sunday")
    .nullable()
    .optional(),
});

/** "YYYY-MM" for the overview's range. */
export const monthParam = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must be YYYY-MM");

export type SaveWeekInput = z.infer<typeof saveWeekSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
