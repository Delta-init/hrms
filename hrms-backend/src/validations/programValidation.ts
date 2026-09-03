import { z } from "zod";

/**
 * `seatsTaken` is deliberately absent from both schemas.
 *
 * It is derived by the atomic claim in the service, and accepting it from a
 * form would let a caller write the one number the overbooking guard depends
 * on. Nothing outside that claim ever sets it.
 */
const base = {
  title: z.string().trim().min(1, "Title is required").max(150),
  description: z.string().trim().max(2000).optional(),
  location: z.string().trim().max(200).optional(),
  startsAt: z.coerce.date({ errorMap: () => ({ message: "A start date and time is required" }) }),
  endsAt: z.coerce.date().nullish(),
  /** Zero means unlimited — a briefing everybody may attend still wants a register. */
  capacity: z.coerce.number().int().min(0, "Cannot be negative").max(100_000).default(0),
  status: z.enum(["draft", "open", "closed", "cancelled"]).default("draft"),
};

const endsAfterStart = (v: { startsAt?: Date; endsAt?: Date | null }, ctx: z.RefinementCtx) => {
  if (v.startsAt && v.endsAt && v.endsAt <= v.startsAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endsAt"], message: "The end must be after the start" });
  }
};

export const createProgramSchema = z.object(base).superRefine(endsAfterStart);

export const updateProgramSchema = z.object(base).partial().superRefine(endsAfterStart);

export type CreateProgramInput = z.infer<typeof createProgramSchema>;
export type UpdateProgramInput = z.infer<typeof updateProgramSchema>;
