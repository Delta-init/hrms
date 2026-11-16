import { describe, expect, it } from "bun:test";
import { canAnswer, canWriteUp, fileList, homeworkEntries, homeworkStatus } from "./homework.js";

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
  const entry = (over: Record<string, unknown> = {}) => {
    const e = {
      id: "a", title: "T", day: "2026-11-16", dueDay: "2026-11-16", legacy: 0 as const, kind: "document" as const,
      videoSeconds: 0, notes: null, watched: false, vimeo: null, question: f("q.docx"), answer: null, answeredAt: null, ...over,
    };
    const questions = e.question ? [e.question] : [];
    const answers = e.answer ? [e.answer as ReturnType<typeof f>] : [];
    return { ...e, questions, answers, folder: "", handedIn: "handedIn" in over ? !!over.handedIn : !!e.answer };
  };

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

describe("video homework", () => {
  const rec = (h: Record<string, unknown>) => homeworkEntries({
    startDay: "2026-11-12",
    homeworks: [{ _id: "v", title: "Refund call", day: "2026-11-16", kind: "video", videoSeconds: 522, question: f("refund.mp4"), addedAt: new Date("2026-11-16T05:00:00Z"), ...h }],
  }, TZ)[0];

  it("is not handed in by watching — the write-up is the hand-in", () => {
    const watched = rec({ watch: { completedAt: new Date("2026-11-16T08:00:00Z") } });
    expect([watched.kind, watched.videoSeconds, watched.watched, watched.handedIn]).toEqual(["video", 522, true, false]);
    expect(homeworkStatus(watched, "2026-11-16", TZ).status).toBe("todo");
    const handed = rec({ watch: { completedAt: new Date("2026-11-16T08:00:00Z") }, notes: "Confirm the order first.", answeredAt: new Date("2026-11-17T06:00:00Z") });
    expect(homeworkStatus(handed, "2026-11-17", TZ)).toEqual({ status: "done", late: true });
  });

  it("opens the write-up only once watched, and keeps it open once handed in — even for a new video", () => {
    expect(canWriteUp(rec({}), "2026-11-16")).toBe(false);
    expect(canWriteUp(rec({ watch: { completedAt: new Date() } }), "2026-11-16")).toBe(true);
    expect(canWriteUp(rec({ notes: "Kept from the first video." }), "2026-11-16")).toBe(true);
    expect(canWriteUp(rec({ watch: { completedAt: new Date() } }), "2026-11-15")).toBe(false);
  });

  it("never treats a document as a video", () => {
    const [d] = homeworkEntries({ startDay: "2026-11-12", homeworks: [{ _id: "d", title: "Doc", day: "2026-11-16", question: f("q.docx") }] }, TZ);
    expect([d.kind, d.videoSeconds, canWriteUp({ ...d, watched: true }, "2026-11-16")]).toEqual(["document", 0, false]);
  });
});

describe("video homework from Vimeo", () => {
  it("counts the Vimeo video as its question — open on its day, with no file stored", () => {
    const [e] = homeworkEntries({
      startDay: "2026-11-12",
      homeworks: [{ _id: "v", title: "Refund call", day: "2026-11-16", kind: "video", videoSeconds: 62, question: null, vimeo: { id: "76979871", hash: "", name: "Refund call training" } }],
    }, TZ);
    expect([e.question, e.vimeo?.id, canAnswer(e, "2026-11-16"), homeworkStatus(e, "2026-11-16", TZ).status]).toEqual([null, "76979871", true, "todo"]);
  });
});

describe("several files and folders", () => {
  it("reads a single stored file as a list of one, and a list as it is", () => {
    expect(fileList(null, f("one.pdf")).map((x) => x.name)).toEqual(["one.pdf"]);
    expect(fileList([f("a.pdf"), f("b.pdf")], f("a.pdf")).map((x) => x.name)).toEqual(["a.pdf", "b.pdf"]);
    expect(fileList([], null)).toEqual([]);
  });

  it("keeps every question and answer file of a document homework, and its folder", () => {
    const [e] = homeworkEntries({
      startDay: "2026-11-12",
      homeworks: [{
        _id: "d", title: "Fees", day: "2026-11-16", folder: " Week 1 ",
        question: f("brief.docx"), questionFiles: [f("brief.docx"), f("fees.xlsx"), f("chat.png")],
        answer: f("p1.jpg"), answerFiles: [f("p1.jpg", "2026-11-16T09:00:00Z"), f("p2.jpg", "2026-11-16T09:01:00Z")],
      }],
    }, TZ);
    expect([e.folder, e.questions.length, e.answers.length, e.question?.name, e.handedIn]).toEqual(["Week 1", 3, 2, "brief.docx", true]);
    expect(homeworkStatus(e, "2026-11-20", TZ)).toEqual({ status: "done", late: false });
  });

  it("is not handed in with no answer files, and a video keeps its one MP4", () => {
    const [d, v] = homeworkEntries({
      startDay: "2026-11-12",
      homeworks: [
        { _id: "d", title: "Doc", day: "2026-11-16", questionFiles: [f("q.docx")], answerFiles: [] },
        { _id: "v", title: "Vid", day: "2026-11-17", kind: "video", videoSeconds: 30, question: f("v.mp4"), questionFiles: [f("ignored.pdf")], answerFiles: [f("notes.pdf")] },
      ],
    }, TZ);
    expect([d.handedIn, d.questions.length]).toEqual([false, 1]);
    expect([v.questions.map((x) => x.name), v.answers.length, v.handedIn]).toEqual([["v.mp4"], 1, false]);
  });
});
