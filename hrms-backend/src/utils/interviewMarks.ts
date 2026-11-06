/**
 * Marking an interview against the role's questions.
 *
 * Each question carries its own maximum, set by whoever raised the role, so a
 * sheet's total is out of the sum of those — not a count of questions, and not
 * a fixed scale. A sheet keeps a copy of each question as it was asked: the
 * requester can rewrite the questions afterwards, and a mark has to stay a mark
 * against what was actually put to the candidate.
 */

export interface SheetQuestion {
  _id: unknown;
  question: string;
  expectedAnswer: string;
  maxMarks: number;
}

/** What the panellist sent for one question. */
export interface AnswerInput {
  questionId: string;
  /** What the candidate said, in the panellist's words. */
  response?: string | null;
  marks?: number | null;
}

/** One answer as kept on the sheet — the question copied alongside it. */
export interface SheetAnswer {
  questionId: string;
  question: string;
  expectedAnswer: string;
  maxMarks: number;
  response: string;
  marks: number | null;
}

/** Marks go in halves at the finest — a 7.25 out of 10 is precision nobody has. */
export const validMarks = (marks: number, max: number) =>
  Number.isFinite(marks) && marks >= 0 && marks <= max && Number.isInteger(marks * 2);

/**
 * The sheet's answers for the questions as they stand: one per question, in the
 * requester's order, carrying over whatever was already entered for it. Input
 * for a question that is no longer there is dropped.
 */
export function answersFor(questions: SheetQuestion[], input: AnswerInput[]): SheetAnswer[] {
  const byId = new Map(input.map((a) => [String(a.questionId), a]));
  return questions.map((q) => {
    const a = byId.get(String(q._id));
    return {
      questionId: String(q._id),
      question: q.question,
      expectedAnswer: q.expectedAnswer,
      maxMarks: q.maxMarks,
      response: (a?.response ?? "").trim(),
      marks: a?.marks ?? null,
    };
  });
}

/** Marks that cannot stand, whatever is being saved — named by question number. */
export function badMarks(answers: SheetAnswer[]): string[] {
  return answers.flatMap((a, i) =>
    a.marks != null && !validMarks(a.marks, a.maxMarks)
      ? [`Question ${i + 1}: marks must be between 0 and ${a.maxMarks}, in halves at most`]
      : []
  );
}

/** The question numbers still missing what the candidate said or a mark. */
export function unanswered(answers: SheetAnswer[]): number[] {
  return answers.flatMap((a, i) => (!a.response || a.marks == null ? [i + 1] : []));
}

/** Total, out of what, and as a percentage of it. Null when there is nothing to mark. */
export function sheetTotals(answers: Array<{ marks: number | null; maxMarks: number }>) {
  const maxTotal = answers.reduce((n, a) => n + a.maxMarks, 0);
  if (!maxTotal) return { totalMarks: null, maxTotal: null, percent: null };
  const totalMarks = answers.reduce((n, a) => n + (a.marks ?? 0), 0);
  return { totalMarks, maxTotal, percent: Math.round((totalMarks / maxTotal) * 100) };
}
