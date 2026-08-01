import { z } from "zod";

const questionSchema = z
  .object({
    text: z.string().min(1, "Question text is required").max(300),
    type: z.enum(["text", "single_choice", "rating"]).default("text"),
    options: z.array(z.string().min(1).max(200)).default([]),
    required: z.boolean().default(true),
  })
  .refine((q) => q.type !== "single_choice" || q.options.length >= 2, {
    message: "Single-choice questions need at least 2 options",
    path: ["options"],
  });

export const createSurveySchema = z.object({
  title: z.string().min(1, "Title is required").max(150),
  description: z.string().max(1000).optional(),
  questions: z.array(questionSchema).min(1, "At least one question is required"),
  closesAt: z.coerce.date().optional().nullable(),
});

export const updateSurveySchema = z.object({
  title: z.string().min(1).max(150).optional(),
  description: z.string().max(1000).optional(),
  questions: z.array(questionSchema).min(1, "At least one question is required").optional(),
  closesAt: z.coerce.date().optional().nullable(),
});

export const setSurveyStatusSchema = z.object({
  status: z.enum(["draft", "active", "closed"]),
});

export const submitSurveyResponseSchema = z.object({
  answers: z
    .array(
      z.object({
        question: z.string().min(1, "Question id is required"),
        value: z.union([z.string().max(2000), z.number()]),
      })
    )
    .min(1, "At least one answer is required"),
});

export type CreateSurveyInput = z.infer<typeof createSurveySchema>;
export type UpdateSurveyInput = z.infer<typeof updateSurveySchema>;
export type SetSurveyStatusInput = z.infer<typeof setSurveyStatusSchema>;
export type SubmitSurveyResponseInput = z.infer<typeof submitSurveyResponseSchema>;
