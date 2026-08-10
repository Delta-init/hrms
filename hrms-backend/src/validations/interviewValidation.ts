import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

const base = z.object({
  round: z.coerce.number().int().min(1).max(20).default(1),
  title: z.string().trim().max(120).optional(),
  mode: z.enum(["in_person", "video", "phone"]).default("video"),
  scheduledAt: z.coerce.date(),
  durationMinutes: z.coerce.number().int().min(5).max(600).default(60),
  timeZone: z.string().trim().min(1).default("Asia/Dubai"),
  location: z.string().trim().max(200).optional(),
  meetingLink: z.string().trim().url("Must be a URL").max(500).optional().or(z.literal("")),
  // A pointer to a recording held wherever the meeting tool put it. Nothing is
  // uploaded here, so nothing about consent or retention is this app's to keep.
  recordingLink: z.string().trim().url("Must be a URL").max(500).optional().or(z.literal("")),
  panel: z.array(objectId).max(10).default([]),
  notes: z.string().trim().max(2000).optional(),
  status: z.enum(["scheduled", "completed", "no_show", "cancelled"]).optional(),
});

export const scheduleInterviewSchema = base
  .extend({ application: objectId })
  .superRefine((v, ctx) => {
    if (v.mode === "in_person" && !v.location) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["location"], message: "Say where it is happening" });
    }
    if (v.mode === "video" && !v.meetingLink) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["meetingLink"], message: "A meeting link is needed for a video call" });
    }
    // The invite is useless without somebody to send it to.
    if (!v.panel.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["panel"], message: "Add at least one interviewer" });
    }
  });

export const updateInterviewSchema = base.partial();

export const feedbackSchema = z.object({
  recommendation: z.enum(["strong_yes", "yes", "no", "strong_no"]),
  scores: z.array(z.object({
    skill: z.string().trim().min(1).max(60),
    rating: z.coerce.number().int().min(1).max(5),
  })).max(12).default([]),
  notes: z.string().trim().max(4000).optional(),
});

export const conflictQuerySchema = z.object({
  panel: z.union([z.string(), z.array(z.string())]).transform((v) => (Array.isArray(v) ? v : v.split(",")).filter(Boolean)),
  scheduledAt: z.string().min(1),
  durationMinutes: z.coerce.number().int().min(5).max(600).default(60),
  exclude: objectId.optional(),
});

export type ScheduleInterviewInput = z.infer<typeof scheduleInterviewSchema>;
export type UpdateInterviewInput = z.infer<typeof updateInterviewSchema>;
export type FeedbackInput = z.infer<typeof feedbackSchema>;
