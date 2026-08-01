import { z } from "zod";

export const createCycleSchema = z.object({
  title: z.string().min(1, "Title is required").max(150),
  startDate: z.coerce.date({ errorMap: () => ({ message: "Valid start date is required" }) }),
  endDate: z.coerce.date({ errorMap: () => ({ message: "Valid end date is required" }) }),
});

export const setCycleStatusSchema = z.object({
  status: z.enum(["draft", "active", "closed"]),
});

const goalSchema = z.object({
  _id: z.string().optional(),
  title: z.string().min(1, "Goal title is required").max(150),
  description: z.string().max(1000).optional(),
  weight: z.coerce.number().min(0).max(100).default(0),
  selfRating: z.coerce.number().min(1).max(5).optional().nullable(),
});

export const setGoalsSchema = z.object({
  goals: z.array(goalSchema).min(1, "Add at least one goal"),
});

export const submitSelfReviewSchema = z.object({
  selfComment: z.string().max(2000).optional(),
});

export const reviewAppraisalSchema = z.object({
  managerComment: z.string().max(2000).optional(),
  goalRatings: z.array(z.object({ goalId: z.string(), managerRating: z.coerce.number().min(1).max(5) })),
});

export type CreateCycleInput = z.infer<typeof createCycleSchema>;
export type SetCycleStatusInput = z.infer<typeof setCycleStatusSchema>;
export type SetGoalsInput = z.infer<typeof setGoalsSchema>;
export type SubmitSelfReviewInput = z.infer<typeof submitSelfReviewSchema>;
export type ReviewAppraisalInput = z.infer<typeof reviewAppraisalSchema>;
