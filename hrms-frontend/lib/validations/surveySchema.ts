import { z } from "zod";

export const surveyQuestionFormSchema = z
  .object({
    text: z.string().min(1, "Question text is required").max(300),
    type: z.enum(["text", "single_choice", "rating"]),
    options: z.array(z.string().max(200)).default([]).transform((arr) => arr.map((o) => o.trim()).filter(Boolean)),
    required: z.boolean().default(true),
  })
  .refine((q) => q.type !== "single_choice" || q.options.length >= 2, {
    message: "Add at least 2 options",
    path: ["options"],
  });

export const surveyFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(150),
  description: z.string().max(1000).optional(),
  questions: z.array(surveyQuestionFormSchema).min(1, "Add at least one question"),
  closesAt: z.string().optional(),
});
export type SurveyFormValues = z.infer<typeof surveyFormSchema>;
