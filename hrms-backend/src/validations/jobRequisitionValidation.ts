import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

/**
 * One question for the interview panel. `_id` is sent back for a question that
 * already exists, so an edit keeps it the same question — the marks given
 * against it stay tied to it.
 */
const interviewQuestion = z.object({
  _id: objectId.optional(),
  question: z.string().trim().min(3, "Write the question").max(1000),
  expectedAnswer: z.string().trim().min(1, "Give the expected answer").max(4000),
  maxMarks: z.coerce.number().int("Whole marks only").min(1, "At least 1 mark").max(100, "At most 100 marks"),
});

export const MAX_INTERVIEW_QUESTIONS = 50;
const interviewQuestions = z
  .array(interviewQuestion, { required_error: "Add at least one interview question" })
  .min(1, "Add at least one interview question")
  .max(MAX_INTERVIEW_QUESTIONS, `At most ${MAX_INTERVIEW_QUESTIONS} questions`);

const base = z.object({
  type: z.enum(["replacement", "new_headcount"]),
  replacing: objectId.nullish(),
  title: z.string().trim().min(1, "Give the role a title").max(120),
  department: objectId.nullish(),
  designation: z.string().trim().max(120).optional(),
  location: z.enum(["india", "dubai"]).optional(),
  employmentType: z.enum(["full_time", "part_time", "contract", "intern"]).default("full_time"),
  headcount: z.coerce.number().int().min(1, "At least one").max(999).default(1),
  salaryMin: z.coerce.number().min(0).optional(),
  salaryMax: z.coerce.number().min(0).optional(),
  currency: z.string().trim().toUpperCase().length(3).default("AED"),
  justification: z.string().trim().max(2000).optional(),
  targetStartDate: z.coerce.date().nullish(),
  status: z.enum(["draft", "pending"]).optional(),
  jdText: z.string().trim().max(20000).optional(),
  interviewQuestions: interviewQuestions.optional(),
});

// A new request carries its questions: the panel should not be left to make
// them up on the day.
export const createRequisitionSchema = base.extend({ interviewQuestions }).superRefine((v, ctx) => {
  // Without it there is nothing to compare the proposed salary against, and the
  // budget step would silently never apply.
  if (v.type === "replacement" && !v.replacing) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["replacing"], message: "Say who is being replaced" });
  }
  if (v.salaryMin != null && v.salaryMax != null && v.salaryMin > v.salaryMax) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["salaryMax"], message: "Maximum cannot be below the minimum" });
  }
});

export const updateRequisitionSchema = base.partial().superRefine((v, ctx) => {
  if (v.salaryMin != null && v.salaryMax != null && v.salaryMin > v.salaryMax) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["salaryMax"], message: "Maximum cannot be below the minimum" });
  }
});

export const reviewRequisitionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNote: z.string().trim().max(1000).nullish(),
});

export const setQuestionsSchema = z.object({ interviewQuestions });

export const withdrawRequisitionSchema = z.object({
  reason: z.string().trim().max(500).optional().default(""),
});

export type CreateRequisitionInput = z.infer<typeof createRequisitionSchema>;
export type UpdateRequisitionInput = z.infer<typeof updateRequisitionSchema>;
export type ReviewRequisitionInput = z.infer<typeof reviewRequisitionSchema>;
export type InterviewQuestionInput = z.infer<typeof interviewQuestion>;
