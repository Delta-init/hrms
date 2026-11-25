"use client";
import { Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { describe } from "@/lib/taskRepeat";
import { TASK_STATUS_LABELS, TASK_PRIORITY_LABELS, type Task, type TaskPriority, type TaskStatus } from "@/types";

/* Small pieces every task screen shares — the status pill, the progress bar, the due line (2026-11-25). */

export const STATUS_STYLE: Record<TaskStatus, string> = {
  todo: "border-border bg-muted/60 text-muted-foreground",
  in_progress: "border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  submitted: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  done: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  cancelled: "border-border bg-muted text-muted-foreground line-through",
};

export const PRIORITY_STYLE: Record<TaskPriority, string> = {
  urgent: "text-red-600 dark:text-red-400",
  high: "text-amber-600 dark:text-amber-400",
  normal: "text-muted-foreground",
  low: "text-muted-foreground",
};

/** Sent back: in progress again with HR's last word being "redo". */
export const wasSentBack = (t: Task) => t.status === "in_progress" && t.reviews?.at(-1)?.action === "sent_back";

export function StatusPill({ task, className }: { task: Task; className?: string }) {
  const back = wasSentBack(task);
  return (
    <span className={cn(
      "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
      back ? "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400" : STATUS_STYLE[task.status],
      className
    )}>
      {back ? "Sent back" : TASK_STATUS_LABELS[task.status]}
    </span>
  );
}

export function Progress({ task, wide = false }: { task: Task; wide?: boolean }) {
  const { done, total } = task.progress;
  if (!total) return <span className="text-xs text-muted-foreground">No steps</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className={cn("h-1.5 overflow-hidden rounded-full bg-muted", wide ? "w-32" : "w-20")}>
        <span className="block h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round((done / total) * 100)}%` }} />
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">{done}/{total}</span>
    </span>
  );
}

const DAY = 86_400_000;
/** "Today, 6:00 pm", "Tomorrow", "Fri 27 Nov", or "Overdue by 2 days" — in red when it's late. */
export function dueText(t: Task, now = new Date()): { text: string; tone: "bad" | "warn" | "plain" } {
  const due = new Date(t.dueAt);
  const time = due.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" }).replace(/^0/, "");
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(due) - startOf(now)) / DAY);
  if (t.overdue) {
    const late = Math.max(0, Math.round((startOf(now) - startOf(due)) / DAY));
    return { text: late === 0 ? `Overdue since ${time}` : `Overdue by ${late} day${late === 1 ? "" : "s"}`, tone: "bad" };
  }
  if (t.status === "done" || t.status === "cancelled") return { text: due.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), tone: "plain" };
  if (days === 0) return { text: `Today, ${time}`, tone: "warn" };
  if (days === 1) return { text: `Tomorrow, ${time}`, tone: "plain" };
  return { text: due.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }), tone: "plain" };
}

export function DueLine({ task, className }: { task: Task; className?: string }) {
  const d = dueText(task);
  return <span className={cn("text-xs", d.tone === "bad" ? "font-medium text-red-600 dark:text-red-400" : d.tone === "warn" ? "font-medium text-amber-600 dark:text-amber-400" : "text-muted-foreground", className)}>{d.text}</span>;
}

export function PriorityText({ p }: { p: TaskPriority }) {
  if (p === "normal") return null;
  return <span className={cn("text-xs font-medium", PRIORITY_STYLE[p])}>{TASK_PRIORITY_LABELS[p]}</span>;
}

export const HISTORY_WORDS: Record<string, string> = {
  assigned: "Assigned", edited: "Edited", started: "Started", step_done: "Ticked", step_undone: "Unticked",
  submitted: "Marked done", done: "Marked done", approved: "Approved", sent_back: "Sent back", cancelled: "Cancelled",
};

/** "↻ Every Mon" on a copy made by a repeating task (Part 2). */
export function RepeatTag({ task }: { task: Task }) {
  const s = task.series && typeof task.series === "object" ? task.series : null;
  if (!s) return null;
  return <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Repeat className="h-3 w-3" />{describe(s.repeat as never)}</span>;
}
