import { z } from "zod";

export const cycleFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(150),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().min(1, "End date is required"),
});
export type CycleFormValues = z.infer<typeof cycleFormSchema>;

export const goalFormSchema = z.object({
  _id: z.string().optional(),
  title: z.string().min(1, "Goal title is required").max(150),
  description: z.string().max(1000).optional(),
  weight: z.coerce.number().min(0).max(100).default(0),
  selfRating: z.union([z.coerce.number().min(1).max(5), z.literal("")]).optional().nullable(),
});

export const goalsFormSchema = z.object({
  goals: z.array(goalFormSchema).min(1, "Add at least one goal"),
});
export type GoalsFormValues = z.infer<typeof goalsFormSchema>;
