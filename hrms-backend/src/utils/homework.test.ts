import { describe, expect, it } from "bun:test";
import { canAnswer, homeworkEntries, homeworkStatus } from "./homework.js";

const TZ = "Asia/Dubai";
const f = (name: string, at = "2026-11-12T10:00:00Z") => ({ key: `k/${name}`, name, at: new Date(at) });
const base = { startDay: "2026-11-12", stepDays: ["2026-11-12", "2026-11-13", "2026-11-14"] };

describe("homeworkEntries", () => {
  it("reads the old day-1 and day-2 slots as the first entries, with the due days the joiner was told", () => {
    const list = homeworkEntries({
      ...base,
      homework: f("Day_1.docx"), homeworkResult: f("answer1.pdf", "2026-11-13T08:00:00Z"),
      homework2: null, homework2Result: f("answer2.pdf", "2026-11-14T08:00:00Z"),
    }, TZ);
    expect(list.map((e) => [e.id, e.day, e.dueDay, !!e.question, !!e.answer])).toEqual([
      ["legacy-1", "2026-11-12", "2026-11-13", true, true],
      ["legacy-2", "2026-11-13", "2026-11-14", false, true],
    ]);
  });

  it("leaves out an old slot nobody used", () => {
    expect(homeworkEntries(base, TZ)).toEqual([]);
  });

  it("lists added homework by day, after the old slots on the same day", () => {
    const list = homeworkEntries({
      ...base,
      homework: f("Day_1.docx"),
      homeworks: [
        { _id: "b", title: "Fees objections", day: "2026-11-16", question: f("q5.docx"), addedAt: new Date("2026-11-12T09:00:00Z") },
        { _id: "a", title: "Product notes", day: "2026-11-12", question: f("q1.docx"), addedAt: new Date("2026-11-12T09:00:00Z") },
      ],
    }, TZ);
    expect(list.map((e) => e.id)).toEqual(["legacy-1", "a", "b"]);
  });

  it("makes a homework set for a day already gone due the day it was set", () => {
    const [e] = homeworkEntries({
      ...base,
      homeworks: [{ _id: "a", title: "Day 1, set late", day: "2026-11-12", question: f("q.docx"), addedAt: new Date("2026-11-15T07:00:00Z") }],
    }, TZ);
    expect([e.day, e.dueDay]).toEqual(["2026-11-12", "2026-11-15"]);
  });
});

describe("homeworkStatus", () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    id: "a", title: "T", day: "2026-11-16", dueDay: "2026-11-16", legacy: 0 as const,
    question: f("q.docx"), answer: null, answeredAt: null, ...over,
  });

  it("waits for its day, then is to do that day, then overdue", () => {
    expect(homeworkStatus(entry(), "2026-11-15", TZ).status).toBe("waiting");
    expect(homeworkStatus(entry(), "2026-11-16", TZ).status).toBe("todo");
    expect(homeworkStatus(entry(), "2026-11-17", TZ).status).toBe("overdue");
  });

  it("is on time answered that day in Dubai, and late after it — but done either way", () => {
    // 23:30 Dubai on the 16th is still the 16th.
    expect(homeworkStatus(entry({ answer: f("a.pdf"), answeredAt: new Date("2026-11-16T19:30:00Z") }), "2026-11-20", TZ)).toEqual({ status: "done", late: false });
    expect(homeworkStatus(entry({ answer: f("a.pdf"), answeredAt: new Date("2026-11-16T20:30:00Z") }), "2026-11-20", TZ)).toEqual({ status: "done", late: true });
  });

  it("counts an answer kept from before, with no question on file, as done", () => {
    expect(homeworkStatus(entry({ question: null, answer: f("a.pdf", "2026-11-14T08:00:00Z"), dueDay: "2026-11-14" }), "2026-11-16", TZ))
      .toEqual({ status: "done", late: false });
  });

  it("opens answers only once the question is on file and the day has come", () => {
    expect(canAnswer(entry(), "2026-11-15")).toBe(false);
    expect(canAnswer(entry(), "2026-11-16")).toBe(true);
    expect(canAnswer(entry({ question: null }), "2026-11-16")).toBe(false);
  });
});
