import { z } from "zod";

export const createRoomSchema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  location: z.string().max(120).optional().nullable(),
  capacity: z.coerce.number().int().min(0).optional(),
  active: z.boolean().optional(),
  notes: z.string().max(300).optional().nullable(),
});
export const updateRoomSchema = createRoomSchema.partial();

const booking = {
  room: z.string().min(1, "Room is required"),
  title: z.string().min(1, "Title is required").max(140),
  agenda: z.string().max(1000).optional().nullable(),
  start: z.coerce.date({ errorMap: () => ({ message: "Valid start time is required" }) }),
  end: z.coerce.date({ errorMap: () => ({ message: "Valid end time is required" }) }),
  timeZone: z.string().max(64).default("Asia/Dubai"),
  participants: z.array(z.string()).default([]),
};

/**
 * A booking that ends before it starts is a typo, and one running for days is
 * almost always a date picked in the wrong month. Both are refused here rather
 * than left to block a room for a week.
 */
const MAX_HOURS = 12;
const sane = <T extends { start: Date; end: Date }>(v: T, ctx: z.RefinementCtx) => {
  if (v.end <= v.start) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["end"], message: "The meeting must end after it starts" });
    return;
  }
  if (v.end.getTime() - v.start.getTime() > MAX_HOURS * 3600_000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["end"], message: `A booking cannot run longer than ${MAX_HOURS} hours` });
  }
};

export const createBookingSchema = z.object(booking).superRefine(sane);
export const updateBookingSchema = z.object(booking).superRefine(sane);

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
