import { todayInTz } from "./schedule.js";

/**
 * A new joiner's homework: as many as their department head sets, each for a
 * day of their first fifteen, each with the head's question document and —
 * once that day comes — the joiner's answer.
 *
 * No question, no answer: the joiner can only answer a homework whose question
 * document is on file. Answered by its due day is on time; later is still
 * accepted, and marked late.
 *
 * Two fixed slots came before the list — the day-1 homework (handed back on
 * day 2) and a day-2 one (handed back on day 3). Records that used them keep
 * them, read here as the first entries of the list with the due days their
 * joiners were told, so nothing stored has to change.
 */

export interface HomeworkFile { key?: string | null; name?: string | null; at?: Date | null }

export type HomeworkStatus = "done" | "todo" | "waiting" | "overdue";

export interface HomeworkEntry {
  /** The list entry's id, or "legacy-1" / "legacy-2" for the two fixed slots. */
  id: string;
  title: string;
  /** The day it is for, "YYYY-MM-DD" in the joiner's zone. Answers open then. */
  day: string;
  /** The last day an answer is on time. */
  dueDay: string;
  question: HomeworkFile | null;
  answer: HomeworkFile | null;
  /** When the first answer came in — replacing it later doesn't make it late. */
  answeredAt: Date | null;
  /** 1 or 2 for the old fixed slots; 0 for the list. */
  legacy: 0 | 1 | 2;
}

export interface HomeworkRecordLike {
  startDay: string;
  stepDays?: string[] | null;
  homework?: HomeworkFile | null;
  homeworkResult?: HomeworkFile | null;
  homework2?: HomeworkFile | null;
  homework2Result?: HomeworkFile | null;
  homeworks?: Array<{
    _id?: unknown; title?: string | null; day: string;
    question?: HomeworkFile | null; answer?: HomeworkFile | null;
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
      id: LEGACY_IDS[1], title: "Homework", day: d1, dueDay: d2, legacy: 1,
      question: file(rec.homework), answer: file(rec.homeworkResult), answeredAt: rec.homeworkResult?.at ?? null,
    });
  }
  if (rec.homework2?.key || rec.homework2Result?.key) {
    out.push({
      id: LEGACY_IDS[2], title: "Day-2 homework", day: d2, dueDay: d3, legacy: 2,
      question: file(rec.homework2), answer: file(rec.homework2Result), answeredAt: rec.homework2Result?.at ?? null,
    });
  }
  for (const h of rec.homeworks ?? []) {
    const setOn = h.addedAt ? todayInTz(tz, h.addedAt) : h.day;
    out.push({
      id: String(h._id), title: h.title?.trim() || "Homework", day: h.day, dueDay: setOn > h.day ? setOn : h.day, legacy: 0,
      question: file(h.question), answer: file(h.answer), answeredAt: h.answeredAt ?? h.answer?.at ?? null,
    });
  }
  // Stable, so on the same day the old slots stay ahead of the list.
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/**
 * Where a homework stands today. Answered is done — late if the first answer
 * came after the due day. Unanswered, it waits for its day (or its question),
 * is to do until the due day ends, and overdue after.
 */
export function homeworkStatus(e: HomeworkEntry, today: string, tz: string): { status: HomeworkStatus; late: boolean } {
  if (e.answer) {
    const at = e.answeredAt ?? e.answer.at ?? null;
    return { status: "done", late: !!at && todayInTz(tz, at) > e.dueDay };
  }
  if (!e.question || today < e.day) return { status: "waiting", late: false };
  return { status: today > e.dueDay ? "overdue" : "todo", late: false };
}

/** Whether the joiner can answer it now: its question is on file and its day has come. */
export const canAnswer = (e: HomeworkEntry, today: string) => !!e.question && today >= e.day;
