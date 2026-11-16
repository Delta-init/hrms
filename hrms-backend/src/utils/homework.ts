import { todayInTz } from "./schedule.js";

/**
 * A new joiner's homework: as many as their department head sets, each for a
 * day of their first fifteen, each with the head's question document and —
 * once that day comes — the joiner's answer.
 *
 * No question, no answer: the joiner can only answer a homework whose question
 * is on file. Answered by its due day is on time; later is still accepted,
 * and marked late.
 *
 * A homework is a document or a video. A document's question is a file and
 * its answer is a file. A video's "question" is the video itself: the joiner
 * watches it to the end — back is fine, ahead is not, counted the way the
 * induction video is — and then writes what they learned, with a file if they
 * like. The write-up is the hand-in. The video is either an uploaded MP4 or
 * one from the company's Vimeo folder.
 *
 * A document homework can carry several question files, and the joiner can
 * hand in several answer files (so can a video's write-up). Each homework can
 * sit in a named folder, which only groups it on the page.
 *
 * Two fixed slots came before the list — the day-1 homework (handed back on
 * day 2) and a day-2 one (handed back on day 3). Records that used them keep
 * them, read here as the first entries of the list with the due days their
 * joiners were told, so nothing stored has to change.
 */

/** How many files one homework (or one side of it) can hold. */
export const MAX_FILES = 10;

/**
 * The record's files for one side of a homework, as a list. Homework from
 * before several files were allowed kept one file in a single field; that file
 * is read as a list of one, so nothing stored has to change.
 */
export function fileList(many: HomeworkFile[] | null | undefined, one: HomeworkFile | null | undefined): HomeworkFile[] {
  const list = (many ?? []).filter((f) => f?.key);
  if (list.length) return list;
  return one?.key ? [one] : [];
}

export interface HomeworkFile { key?: string | null; name?: string | null; at?: Date | null }

export type HomeworkStatus = "done" | "todo" | "waiting" | "overdue";
export type HomeworkKind = "document" | "video";

/** A video homework's write-up has to say something: a sentence or two at least. */
export const MIN_WRITE_UP = 20;

export interface HomeworkEntry {
  /** The list entry's id, or "legacy-1" / "legacy-2" for the two fixed slots. */
  id: string;
  title: string;
  /** The day it is for, "YYYY-MM-DD" in the joiner's zone. Answers open then. */
  day: string;
  /** The last day an answer is on time. */
  dueDay: string;
  /** The first question file (the MP4, for an uploaded video) — kept for the single-file rules. */
  question: HomeworkFile | null;
  /** The first answer file. */
  answer: HomeworkFile | null;
  /** Every question file: one for a video or an old homework, up to MAX_FILES for a document. */
  questions: HomeworkFile[];
  /** Every answer file the joiner handed in — a document's answer, or a video write-up's attachments. */
  answers: HomeworkFile[];
  /** The folder it is grouped under on the page; "" for none. */
  folder: string;
  /** When the first answer came in — replacing it later doesn't make it late. */
  answeredAt: Date | null;
  /** 1 or 2 for the old fixed slots; 0 for the list. */
  legacy: 0 | 1 | 2;
  kind: HomeworkKind;
  /** A video's length in seconds; 0 for a document. */
  videoSeconds: number;
  /** A video's write-up — its hand-in. */
  notes: string | null;
  /** Handed in: the answer file for a document, the write-up for a video. */
  handedIn: boolean;
  /** A video watched to the end, as the server counted it. */
  watched: boolean;
  /** A video from the company's Vimeo folder, instead of an uploaded file. */
  vimeo: { id: string; hash: string; name: string } | null;
}

export interface HomeworkRecordLike {
  startDay: string;
  stepDays?: string[] | null;
  homework?: HomeworkFile | null;
  homeworkResult?: HomeworkFile | null;
  homework2?: HomeworkFile | null;
  homework2Result?: HomeworkFile | null;
  homeworks?: Array<{
    _id?: unknown; title?: string | null; day: string; kind?: string | null; videoSeconds?: number | null;
    question?: HomeworkFile | null; answer?: HomeworkFile | null; notes?: string | null;
    questionFiles?: HomeworkFile[] | null; answerFiles?: HomeworkFile[] | null; folder?: string | null;
    watch?: { completedAt?: Date | null } | null;
    vimeo?: { id?: string | null; hash?: string | null; name?: string | null } | null;
    answeredAt?: Date | null; addedAt?: Date | null;
  }> | null;
}

export const LEGACY_IDS = { 1: "legacy-1", 2: "legacy-2" } as const;

const file = (f: HomeworkFile | null | undefined) => (f?.key ? f : null);

/**
 * Every homework on the record, by day. A homework set for a day that had
 * already passed is due the day it was set — the joiner is never late because
 * the homework was.
 */
export function homeworkEntries(rec: HomeworkRecordLike, tz: string): HomeworkEntry[] {
  const [d1, d2, d3] = [0, 1, 2].map((i) => rec.stepDays?.[i] ?? rec.startDay);
  const out: HomeworkEntry[] = [];
  if (rec.homework?.key || rec.homeworkResult?.key) {
    out.push({
      id: LEGACY_IDS[1], title: "Homework", day: d1, dueDay: d2, legacy: 1, kind: "document", videoSeconds: 0, notes: null, watched: false, vimeo: null,
      question: file(rec.homework), answer: file(rec.homeworkResult), answeredAt: rec.homeworkResult?.at ?? null,
      questions: fileList(null, rec.homework), answers: fileList(null, rec.homeworkResult), folder: "",
      handedIn: !!rec.homeworkResult?.key,
    });
  }
  if (rec.homework2?.key || rec.homework2Result?.key) {
    out.push({
      id: LEGACY_IDS[2], title: "Day-2 homework", day: d2, dueDay: d3, legacy: 2, kind: "document", videoSeconds: 0, notes: null, watched: false, vimeo: null,
      question: file(rec.homework2), answer: file(rec.homework2Result), answeredAt: rec.homework2Result?.at ?? null,
      questions: fileList(null, rec.homework2), answers: fileList(null, rec.homework2Result), folder: "",
      handedIn: !!rec.homework2Result?.key,
    });
  }
  for (const h of rec.homeworks ?? []) {
    const setOn = h.addedAt ? todayInTz(tz, h.addedAt) : h.day;
    const video = h.kind === "video";
    const notes = h.notes?.trim() || null;
    // A video's "question" is its one MP4; a document's can be several files.
    const questions = video ? fileList(null, h.question) : fileList(h.questionFiles, h.question);
    const answers = fileList(h.answerFiles, h.answer);
    out.push({
      id: String(h._id), title: h.title?.trim() || "Homework", day: h.day, dueDay: setOn > h.day ? setOn : h.day, legacy: 0,
      kind: video ? "video" : "document", videoSeconds: video ? h.videoSeconds ?? 0 : 0, notes,
      question: questions[0] ?? null, answer: answers[0] ?? null, questions, answers, folder: h.folder?.trim() ?? "",
      answeredAt: h.answeredAt ?? (video ? null : answers[0]?.at ?? null),
      handedIn: video ? !!notes : answers.length > 0,
      watched: video && !!h.watch?.completedAt,
      vimeo: video && h.vimeo?.id ? { id: h.vimeo.id, hash: h.vimeo.hash ?? "", name: h.vimeo.name ?? "" } : null,
    });
  }
  // Stable, so on the same day the old slots stay ahead of the list.
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/**
 * Where a homework stands today. Handed in is done — late if it first came in
 * after the due day. Otherwise it waits for its day (or its question), is to
 * do until the due day ends, and overdue after. Watching a video is not
 * handing it in: the write-up is.
 */
export function homeworkStatus(e: HomeworkEntry, today: string, tz: string): { status: HomeworkStatus; late: boolean } {
  if (e.handedIn) {
    const at = e.answeredAt ?? e.answer?.at ?? null;
    return { status: "done", late: !!at && todayInTz(tz, at) > e.dueDay };
  }
  if (!hasQuestion(e) || today < e.day) return { status: "waiting", late: false };
  return { status: today > e.dueDay ? "overdue" : "todo", late: false };
}

/** Its question is on file: the document, or the video — uploaded or from Vimeo. */
export const hasQuestion = (e: HomeworkEntry) => !!e.question || !!e.vimeo;

/** Whether it is open to the joiner: its question (or video) is on file and its day has come. */
export const canAnswer = (e: HomeworkEntry, today: string) => hasQuestion(e) && today >= e.day;

/** A video's write-up opens once it has been watched to the end — or stays open once handed in. */
export const canWriteUp = (e: HomeworkEntry, today: string) => e.kind === "video" && canAnswer(e, today) && (e.watched || e.handedIn);
