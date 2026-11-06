import { describe, expect, it } from "bun:test";
import { answersFor, badMarks, sheetTotals, unanswered, validMarks } from "./interviewMarks.js";

const questions = [
  { _id: "q1", question: "Tell us about a hard customer", expectedAnswer: "Listens, de-escalates", maxMarks: 10 },
  { _id: "q2", question: "What is our refund window?", expectedAnswer: "14 days", maxMarks: 5 },
];

describe("answersFor", () => {
  it("is one answer per question, in the requester's order, with the question copied", () => {
    const answers = answersFor(questions, [
      { questionId: "q2", response: " 14 days ", marks: 5 },
      { questionId: "q1", response: "Stayed calm", marks: 7.5 },
    ]);
    expect(answers).toEqual([
      { questionId: "q1", question: "Tell us about a hard customer", expectedAnswer: "Listens, de-escalates", maxMarks: 10, response: "Stayed calm", marks: 7.5 },
      { questionId: "q2", question: "What is our refund window?", expectedAnswer: "14 days", maxMarks: 5, response: "14 days", marks: 5 },
    ]);
  });

  it("leaves a question nobody has reached yet blank, and drops input for one that is gone", () => {
    const answers = answersFor(questions, [{ questionId: "removed", response: "x", marks: 1 }]);
    expect(answers.map((a) => [a.questionId, a.response, a.marks])).toEqual([["q1", "", null], ["q2", "", null]]);
  });
});

describe("validMarks and badMarks", () => {
  it("takes whole and half marks from 0 to the maximum", () => {
    expect(validMarks(0, 10)).toBe(true);
    expect(validMarks(7.5, 10)).toBe(true);
    expect(validMarks(10, 10)).toBe(true);
    expect(validMarks(10.5, 10)).toBe(false);
    expect(validMarks(-1, 10)).toBe(false);
    expect(validMarks(7.25, 10)).toBe(false);
  });

  it("names the question with a mark that cannot stand", () => {
    const answers = answersFor(questions, [{ questionId: "q2", response: "x", marks: 6 }]);
    expect(badMarks(answers)).toEqual(["Question 2: marks must be between 0 and 5, in halves at most"]);
  });
});

describe("unanswered", () => {
  it("lists every question missing what was said or a mark", () => {
    const answers = answersFor(questions, [
      { questionId: "q1", response: "Stayed calm", marks: null },
      { questionId: "q2", response: "", marks: 3 },
    ]);
    expect(unanswered(answers)).toEqual([1, 2]);
  });

  it("is empty for a complete sheet, a zero being a mark", () => {
    const answers = answersFor(questions, [
      { questionId: "q1", response: "Did not know", marks: 0 },
      { questionId: "q2", response: "14 days", marks: 5 },
    ]);
    expect(unanswered(answers)).toEqual([]);
  });
});

describe("sheetTotals", () => {
  it("is out of the sum of each question's maximum", () => {
    expect(sheetTotals([{ marks: 7.5, maxMarks: 10 }, { marks: 5, maxMarks: 5 }])).toEqual({ totalMarks: 12.5, maxTotal: 15, percent: 83 });
  });

  it("counts an unmarked question as nothing yet", () => {
    expect(sheetTotals([{ marks: null, maxMarks: 10 }, { marks: 5, maxMarks: 10 }])).toEqual({ totalMarks: 5, maxTotal: 20, percent: 25 });
  });

  it("is null with no questions to mark", () => {
    expect(sheetTotals([])).toEqual({ totalMarks: null, maxTotal: null, percent: null });
  });
});
