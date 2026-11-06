import * as XLSX from "xlsx";
import { exportToExcel } from "@/lib/excel";
import type { InterviewQuestion } from "@/types";

/**
 * Interview questions in and out of a spreadsheet, and the rules a list of
 * them has to meet — the same rules the server applies, said here first so the
 * form can point at the exact box.
 */

export const MAX_QUESTIONS = 50;
export const DEFAULT_MAX_MARKS = 10;

export const blankQuestion = (): InterviewQuestion => ({ question: "", expectedAnswer: "", maxMarks: DEFAULT_MAX_MARKS });

/** A row nobody has typed into. Dropped before saving rather than refused. */
export const isBlankQuestion = (q: InterviewQuestion) => !q.question.trim() && !q.expectedAnswer.trim();

export type QuestionErrors = Partial<Record<"question" | "expectedAnswer" | "maxMarks", string>>;

/** What is wrong with each question, by position. Empty objects for the good ones. */
export function questionErrors(list: InterviewQuestion[]): QuestionErrors[] {
  return list.map((q) => {
    const e: QuestionErrors = {};
    if (q.question.trim().length < 3) e.question = "Write the question";
    if (!q.expectedAnswer.trim()) e.expectedAnswer = "Give the expected answer";
    if (!Number.isInteger(q.maxMarks) || q.maxMarks < 1 || q.maxMarks > 100) e.maxMarks = "Whole marks, 1 to 100";
    return e;
  });
}

/** Ready to save: at least one question, none of them wrong, not too many. */
export function questionsReady(list: InterviewQuestion[]): string | null {
  const kept = list.filter((q) => !isBlankQuestion(q));
  if (!kept.length) return "Add at least one interview question";
  if (kept.length > MAX_QUESTIONS) return `At most ${MAX_QUESTIONS} questions`;
  if (questionErrors(kept).some((e) => Object.keys(e).length)) return "Some questions are missing something — see the boxes marked in red";
  return null;
}

const TEMPLATE_HEADERS = { question: "Question", answer: "Expected answer", marks: "Max marks" } as const;

/** An Excel file with the three columns, and one example row to overwrite. */
export function downloadQuestionsTemplate() {
  exportToExcel("interview-questions-template", [{
    [TEMPLATE_HEADERS.question]: "Tell us about a time you handled an unhappy customer.",
    [TEMPLATE_HEADERS.answer]: "Listened first, stayed calm, offered a fix within policy, followed up afterwards.",
    [TEMPLATE_HEADERS.marks]: DEFAULT_MAX_MARKS,
  }], "Questions");
}

/** "Expected Answer", "expected_answer", " answer " — all the same column. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const pick = (row: Record<string, unknown>, ...names: string[]) => {
  const keys = Object.keys(row);
  for (const name of names) {
    const k = keys.find((key) => norm(key) === name);
    if (k !== undefined && row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
  }
  return "";
};

/**
 * Questions from rows read off a sheet. A row with neither a question nor an
 * answer is skipped silently — spreadsheets trail empty rows. Anything else
 * that is not usable is reported by its row number, as the person sees it in
 * Excel (headers on row 1).
 */
export function questionsFromRows(rows: Array<Record<string, unknown>>) {
  const questions: InterviewQuestion[] = [];
  const problems: string[] = [];
  rows.forEach((row, i) => {
    // The reader skips wholly empty lines, so position in the list is not the
    // row in Excel; it notes the real one (0-based) on each row it returns.
    const rowNum = (row as { __rowNum__?: unknown }).__rowNum__;
    const line = typeof rowNum === "number" ? rowNum + 1 : i + 2;
    const question = pick(row, "question", "questions");
    const expectedAnswer = pick(row, "expectedanswer", "answer", "expected", "modelanswer");
    const marksText = pick(row, "maxmarks", "marks", "maximummarks", "outof");
    if (!question && !expectedAnswer) return;
    if (!question) { problems.push(`Row ${line}: no question`); return; }
    if (!expectedAnswer) { problems.push(`Row ${line}: no expected answer`); return; }
    const maxMarks = marksText ? Number(marksText) : DEFAULT_MAX_MARKS;
    if (!Number.isInteger(maxMarks) || maxMarks < 1 || maxMarks > 100) {
      problems.push(`Row ${line}: max marks must be a whole number from 1 to 100`);
      return;
    }
    questions.push({ question: question.slice(0, 1000), expectedAnswer: expectedAnswer.slice(0, 4000), maxMarks });
  });
  return { questions, problems };
}

/** Read the first sheet of an .xlsx, .xls or .csv. */
export async function readQuestionsFile(file: File) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { questions: [], problems: ["The file has no sheets"] };
  return questionsFromRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }));
}
