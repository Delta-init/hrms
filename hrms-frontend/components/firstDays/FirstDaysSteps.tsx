"use client";
import { useState } from "react";
import {
  Check, CheckCircle2, Circle, Clock, Copy, ExternalLink, PlayCircle, Plus, Video, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { TeamVideoPlayer } from "@/components/firstDays/TeamVideoPlayer";
import { AddHomeworkDialog } from "@/components/firstDays/AddHomeworkDialog";
import { FileLink, UploadButton } from "@/components/firstDays/FirstDaysFiles";
import { VideoHomeworkBody } from "@/components/firstDays/VideoHomework";
import {
  useAnswerHomework, useAssignClients, useCallsDone, useConfirmMySession, useConfirmSessionAsHead,
  useSetHomeworkQuestion, useSetToolAccess, useSubmitRolePlay, useSubmitCallNotes,
} from "@/hooks/useFirstDays";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { FirstDaysHomework, FirstDaysStep, FirstDaysStepStatus, FirstDaysView } from "@/types";

const STATUS: Record<FirstDaysStepStatus, { label: string; tone: string; icon: React.ElementType }> = {
  done: { label: "Done", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", icon: CheckCircle2 },
  todo: { label: "To do", tone: "bg-primary/10 text-primary", icon: Circle },
  waiting: { label: "Not yet", tone: "bg-muted text-muted-foreground", icon: Clock },
  overdue: { label: "Overdue", tone: "bg-red-500/10 text-red-700 dark:text-red-400", icon: AlertTriangle },
};
const LATE = { label: "Answered late", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400" };

const fmtDay = (key: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
/** "Sat 07 Nov, 13:00" — or just the day, when it opens at the start of it. */
const fmtOpens = (iso: string) => {
  const d = new Date(iso);
  const atMidnight = d.getHours() === 0 && d.getMinutes() === 0;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "2-digit", month: "short", ...(atMidnight ? {} : { hour: "2-digit", minute: "2-digit" }),
  }).format(d);
};

/** What moves a homework on — setting the day-1 one, answering, watching, writing up — not replacing a file. */
const HOMEWORK_MOVES = ["add", "answer", "watch", "writeUp"];

/** Steps the person looking can act on now. */
export const actionsFor = (v: FirstDaysView) =>
  v.steps.filter((s) => s.status !== "done" && s.can.length > 0).length
  + (v.homework?.items ?? []).filter((h) => h.status !== "done" && h.can.some((a) => HOMEWORK_MOVES.includes(a))).length;

/**
 * Days 1 to 3, step by step, for whoever is looking. The joiner, their head
 * and HR see the same steps; each sees only the buttons the server says are
 * theirs (`can`), so this never decides who may do what.
 */
export function FirstDaysSteps({ view }: { view: FirstDaysView }) {
  return (
    <div className="space-y-5">
      {[1, 2, 3].map((day) => {
        const steps = view.steps.filter((s) => s.day === day);
        if (!steps.length) return null;
        return (
          <section key={day} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Day {day} · {fmtDay(view.stepDays[day - 1])}
            </h3>
            {steps.map((s) => <StepRow key={s.key} step={s} view={view} />)}
          </section>
        );
      })}
      <HomeworkSection view={view} />
    </div>
  );
}

/**
 * Every homework, by day: the head's question and the joiner's answer side
 * by side. The joiner answers from the homework's day, once its question is
 * on file; the head or HR sets new ones during the fifteen days.
 */
function HomeworkSection({ view }: { view: FirstDaysView }) {
  const hw = view.homework;
  // The day the add form opens on; null while it is closed.
  const [adding, setAdding] = useState<string | null>(null);
  if (!hw) return null;
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Homework</h3>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{hw.answered} of {hw.total} answered</span>
          {hw.canAdd && (
            <Button size="sm" variant="outline" className="h-8" onClick={() => setAdding(view.today)}><Plus className="h-3.5 w-3.5" />Add homework</Button>
          )}
        </div>
      </div>
      {hw.items.length === 0
        ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No homework yet.</p>
        : hw.items.map((h) => <HomeworkRow key={h.id} item={h} view={view} onAdd={setAdding} />)}
      {hw.canAdd && (
        <AddHomeworkDialog view={view} day={adding} onClose={() => setAdding(null)} />
      )}
    </section>
  );
}

function homeworkDetail(h: FirstDaysHomework, view: FirstDaysView) {
  const joiner = view.viewer.isJoiner;
  const due = h.dueDay === view.today ? "today" : fmtDay(h.dueDay);
  if (h.placeholder) {
    if (joiner) return "Your department head sets it after your day-1 session.";
    return h.can.includes("add") ? "Expected on day 1 — set it after the session; they answer it that day." : "None was set during their fifteen days.";
  }
  if (h.status === "done") {
    if (h.missingQuestion && !joiner) return "Handed in before questions were required — attach the question to keep the record whole.";
    return h.late ? `Handed in after it was due (${fmtDay(h.dueDay)}).` : "Handed in on time.";
  }
  if (h.status === "waiting") return joiner ? `Opens ${fmtDay(h.day)} — you answer it that day.` : `Opens for them ${fmtDay(h.day)}.`;
  const by = due === "today" ? "today" : `by ${due}`;
  if (h.kind === "video") {
    const seen = h.watched ? "Watched in full" : `${h.percent}% watched`;
    if (!joiner) return h.status === "overdue" ? `Was due ${fmtDay(h.dueDay)}. ${seen}.` : `Due ${due}. ${seen}.`;
    if (h.watched) return h.status === "overdue"
      ? `Watched — now write what you learned. It was due ${fmtDay(h.dueDay)}, so it will be marked late.`
      : `Watched — now write what you learned, ${by}.`;
    return h.status === "overdue"
      ? `It was due ${fmtDay(h.dueDay)} — watch it to the end and write it up; it will be marked late.`
      : `Watch it to the end ${by} — you can go back, but not skip ahead — then write what you learned.`;
  }
  if (h.status === "overdue") {
    return joiner ? `It was due ${fmtDay(h.dueDay)} — you can still hand it in; it will be marked late.` : `Was due ${fmtDay(h.dueDay)}.`;
  }
  return joiner ? `Answer it ${by} — upload what you did as a file.` : `Due ${due}.`;
}

function HomeworkRow({ item: h, view, onAdd }: { item: FirstDaysHomework; view: FirstDaysView; onAdd: (day: string) => void }) {
  const answer = useAnswerHomework();
  const question = useSetHomeworkQuestion();
  const can = (a: string) => h.can.includes(a);
  const st = STATUS[h.status];
  const chip = h.status === "done" && h.late ? LATE : h.status === "done" ? { ...st, label: "Answered" } : st;
  const joiner = view.viewer.isJoiner;
  return (
    <div className={cn("rounded-xl border p-4", h.status === "overdue" ? "border-red-500/30" : h.status === "todo" && joiner ? "border-primary/40" : "border-border")}>
      <div className="flex flex-wrap items-start gap-2">
        <st.icon className={cn("mt-0.5 h-4 w-4 shrink-0", h.status === "done" ? (h.late ? "text-amber-600" : "text-emerald-600") : h.status === "overdue" ? "text-red-600" : "text-muted-foreground")} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {h.kind === "video" && <Video className="mr-1 inline h-4 w-4 -translate-y-px text-muted-foreground" aria-label="Video" />}
            {h.title}
            <span className="font-normal text-muted-foreground"> · Day {h.dayNumber}{h.day === view.today ? " (today)" : ""}</span>
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{homeworkDetail(h, view)}</p>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", chip.tone)}>{chip.label}</span>
      </div>
      {h.kind === "video" && !h.placeholder ? <VideoHomeworkBody item={h} view={view} /> : (
      <div className="mt-3 flex flex-wrap items-center gap-2 pl-6">
        {h.question && <FileLink file={h.question} label="Question" />}
        {h.answer && <FileLink file={h.answer} label={joiner ? "Your answer" : "Answer"} />}
        {!joiner && !h.placeholder && !h.answer && h.status !== "waiting" && <span className="text-xs text-muted-foreground">Not answered yet.</span>}
        {(can("answer") || can("replaceAnswer")) && (
          <UploadButton label={can("replaceAnswer") ? "Upload again" : "Upload your answer"} busy={answer.isPending}
            onFile={(file) => answer.mutate({ itemId: h.id, file })} />
        )}
        {(can("replaceQuestion") || can("attachQuestion")) && (
          <UploadButton label={can("attachQuestion") ? "Attach the question" : "Replace the question"} busy={question.isPending}
            onFile={(file) => question.mutate({ employeeId: view.employee._id, itemId: h.id, file, kind: "document" })} />
        )}
        {can("add") && (
          <Button size="sm" onClick={() => onAdd(h.day)}><Plus className="h-3.5 w-3.5" />Add the day-1 homework</Button>
        )}
      </div>
      )}
    </div>
  );
}

function StepRow({ step, view }: { step: FirstDaysStep; view: FirstDaysView }) {
  const st = STATUS[step.status];
  return (
    <div className={cn("rounded-xl border p-4", step.status === "overdue" ? "border-red-500/30" : "border-border")}>
      <div className="flex flex-wrap items-start gap-2">
        <st.icon className={cn("mt-0.5 h-4 w-4 shrink-0", step.status === "done" ? "text-emerald-600" : step.status === "overdue" ? "text-red-600" : "text-muted-foreground")} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{step.title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{step.detail}</p>
          {step.status === "waiting" && (
            <p className="mt-1 text-xs text-muted-foreground">
              {step.waitingFor ? `Waiting for ${step.waitingFor}.` : step.opensAt ? `Opens ${fmtOpens(step.opensAt)}.` : null}
            </p>
          )}
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", st.tone)}>{st.label}</span>
      </div>
      <div className="mt-3 pl-6">
        <StepBody step={step} view={view} />
      </div>
    </div>
  );
}

function StepBody({ step, view }: { step: FirstDaysStep; view: FirstDaysView }) {
  const employeeId = view.employee._id;
  const can = (a: string) => step.can.includes(a);
  const confirmMine = useConfirmMySession();
  const confirmHead = useConfirmSessionAsHead();
  const rolePlay = useSubmitRolePlay();
  const callNotes = useSubmitCallNotes();
  const access = useSetToolAccess();
  const assign = useAssignClients();
  const callsDone = useCallsDone();
  const [watching, setWatching] = useState(false);
  const [link, setLink] = useState("");
  const [notes, setNotes] = useState<string | null>(null);

  switch (step.key) {
    case "session":
      return (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className={cn("inline-flex items-center gap-1", step.joinerConfirmed ? "text-emerald-600" : "text-muted-foreground")}>
            {step.joinerConfirmed ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3" />}{view.viewer.isJoiner ? "You" : view.employee.name}
          </span>
          <span className={cn("inline-flex items-center gap-1", step.headConfirmed ? "text-emerald-600" : "text-muted-foreground")}>
            {step.headConfirmed ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3" />}Department head
          </span>
          {can("confirm") && (
            <Button size="sm" disabled={confirmMine.isPending} onClick={() => confirmMine.mutate()}>I attended the session</Button>
          )}
          {can("confirmHead") && (
            <Button size="sm" disabled={confirmHead.isPending} onClick={() => confirmHead.mutate(employeeId)}>Confirm the session</Button>
          )}
        </div>
      );

    case "teamVideo":
      if (watching) return <TeamVideoPlayer />;
      return (
        <div className="flex flex-wrap items-center gap-3">
          {step.video && <span className="text-xs text-muted-foreground">{step.video.title} · {step.percent ?? 0}% watched</span>}
          {can("watch") && (
            <Button size="sm" onClick={() => setWatching(true)}><PlayCircle className="h-3.5 w-3.5" />Watch the video</Button>
          )}
        </div>
      );

    case "callListening": {
      const editing = can("submit") || can("replace");
      const draft = notes ?? step.notes ?? "";
      return (
        <div className="space-y-2">
          {step.notes && !editing && <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">{step.notes}</p>}
          {editing && (
            <>
              <Textarea rows={4} maxLength={4000} value={draft} onChange={(e) => setNotes(e.target.value)}
                placeholder="What happened on the calls — how the caller opened, the questions the client asked, how objections were handled, what you'd do the same or differently." />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={draft.trim().length < 20 || callNotes.isPending}
                  onClick={() => callNotes.mutate(draft.trim(), { onSuccess: () => setNotes(null) })}>
                  {can("replace") ? "Save changes" : "Hand in your write-up"}
                </Button>
                {draft.trim().length < 20 && <span className="text-[11px] text-muted-foreground">A sentence or two at least.</span>}
              </div>
            </>
          )}
        </div>
      );
    }

    case "rolePlay":
      return (
        <div className="space-y-2">
          {step.prompt && (view.viewer.isJoiner ? step.status !== "waiting" : true) && (
            <div className="rounded-lg bg-muted/50 p-3">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">Paste this into ChatGPT</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-7"
                    onClick={() => navigator.clipboard.writeText(step.prompt!).then(() => toast.success("Prompt copied"), () => toast.error("Could not copy — select it and copy instead"))}>
                    <Copy className="h-3.5 w-3.5" />Copy
                  </Button>
                  <a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer"
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-xs hover:bg-muted">
                    <ExternalLink className="h-3.5 w-3.5" />Open ChatGPT
                  </a>
                </div>
              </div>
              <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs">{step.prompt}</p>
            </div>
          )}
          {step.link && (
            <a href={step.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <ExternalLink className="h-3 w-3" />The chat
            </a>
          )}
          {(can("submit") || can("replace")) && (
            <div className="flex flex-wrap items-center gap-2">
              <Input className="h-8 max-w-md" placeholder="https://chatgpt.com/share/…" value={link} onChange={(e) => setLink(e.target.value)} />
              <Button size="sm" disabled={!link.trim() || rolePlay.isPending}
                onClick={() => rolePlay.mutate(link.trim(), { onSuccess: () => setLink("") })}>
                {can("replace") ? "Replace the link" : "Hand it in"}
              </Button>
            </div>
          )}
          {can("submit") && (
            <p className="text-[11px] text-muted-foreground">When you&apos;re done, type END for your feedback, then use ChatGPT&apos;s Share button and paste the link here.</p>
          )}
        </div>
      );

    case "access": {
      const tools = step.tools!;
      const rows: Array<{ tool: "threeCx" | "zoho" | "crm"; label: string; given: boolean; who: string }> = [
        { tool: "threeCx", label: "3CX", given: tools.threeCx, who: "HR" },
        { tool: "zoho", label: "Zoho", given: tools.zoho, who: "HR" },
        ...(tools.crm !== null ? [{ tool: "crm" as const, label: "Sales CRM", given: tools.crm, who: "Department head" }] : []),
      ];
      return (
        <div className="flex flex-wrap gap-4">
          {rows.map((r) => (
            <label key={r.tool} className={cn("flex items-center gap-2 text-sm", !can(r.tool) && "cursor-default")}>
              <Checkbox
                checked={r.given}
                disabled={!can(r.tool) || access.isPending}
                onCheckedChange={(v) => access.mutate({ employeeId, tool: r.tool, given: v === true })}
              />
              <span>{r.label}</span>
              <span className="text-[11px] text-muted-foreground">({r.who})</span>
            </label>
          ))}
        </div>
      );
    }

    case "coldCalls":
      return (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className={cn("inline-flex items-center gap-1", step.assigned ? "text-emerald-600" : "text-muted-foreground")}>
            {step.assigned ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3 w-3" />}Default clients assigned
          </span>
          {can("assign") && (
            <Button size="sm" disabled={assign.isPending} onClick={() => assign.mutate(employeeId)}>Clients assigned in the CRM</Button>
          )}
          {can("done") && (
            <Button size="sm" disabled={callsDone.isPending} onClick={() => callsDone.mutate()}>I&apos;ve made the calls</Button>
          )}
        </div>
      );

    default:
      return null;
  }
}
