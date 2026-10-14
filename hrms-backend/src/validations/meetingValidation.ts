import { z } from "zod";

export const createRoomSchema = z.object({
  name: z.string().min(1, "Name is required").max(80),
  location: z.string().max(120).optional().nullable(),
  capacity: z.coerce.number().int().min(0).optional(),
  active: z.boolean().optional(),
  notes: z.string().max(300).optional().nullable(),
});
export const updateRoomSchema = createRoomSchema.partial();

const url = z.string().trim().max(500).refine((v) => v === "" || /^https?:\/\//i.test(v), "Must be a link starting with http:// or https://");

const booking = {
  room: z.string().optional().nullable(),
  kind: z.enum(["meeting", "review"]).default("meeting"),
  mode: z.enum(["room", "online", "place"]).default("room"),
  meetingLink: url.optional().default(""),
  placeAddress: z.string().trim().max(300).optional().default(""),
  placeMapUrl: url.optional().default(""),
  /** Review meetings: the login of the employee being reviewed. */
  revieweeUser: z.string().optional().nullable(),
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
const sane = <T extends { start: Date; end: Date; kind: string; mode: string; room?: string | null; meetingLink?: string; placeAddress?: string; revieweeUser?: string | null }>(v: T, ctx: z.RefinementCtx) => {
  // A plain meeting books a room; only a review meeting may be online or elsewhere.
  if (v.kind === "meeting" && v.mode !== "room") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mode"], message: "A meeting books a room" });
  if (v.mode === "room" && !v.room) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["room"], message: "Room is required" });
  if (v.mode === "online" && !v.meetingLink) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["meetingLink"], message: "Add the meeting link" });
  if (v.mode === "place" && !v.placeAddress?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["placeAddress"], message: "Say where it is" });
  if (v.kind === "review" && !v.revieweeUser) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["revieweeUser"], message: "Choose who is being reviewed" });
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

/** The review form, written by the organiser after the meeting. */
export const reviewFormSchema = z.object({
  rating: z.coerce.number().int().min(1, "Give a rating from 1 to 5").max(5),
  strengths: z.string().trim().max(2000).optional().default(""),
  improvements: z.string().trim().max(2000).optional().default(""),
  actions: z.array(z.object({
    text: z.string().trim().min(1).max(300),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  })).max(20).default([]),
  outcome: z.enum(["on_track", "needs_improvement", "performance_plan"]),
  recordingLink: url.optional().default(""),
});
export const recordingSchema = z.object({ recordingLink: url });
export type ReviewFormInput = z.infer<typeof reviewFormSchema>;

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type UpdateRoomInput = z.infer<typeof updateRoomSchema>;
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
