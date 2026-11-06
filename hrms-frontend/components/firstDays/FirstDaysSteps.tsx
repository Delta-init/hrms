"use client";
import { useRef, useState } from "react";
import {
  Check, CheckCircle2, Circle, Clock, Copy, ExternalLink, FileText, Loader2, PlayCircle, Upload, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { TeamVideoPlayer } from "@/components/firstDays/TeamVideoPlayer";
import {
  useAssignClients, useCallsDone, useConfirmMySession, useConfirmSessionAsHead, useHandInHomework,
  useSendHomework, useSetToolAccess, useSubmitRolePlay,
} from "@/hooks/useFirstDays";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { FirstDaysStep, FirstDaysStepStatus, FirstDaysView } from "@/types";

const DOC_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,image/*";

const STATUS: Record<FirstDaysStepStatus, { label: string; tone: string; icon: React.ElementType }> = {
  done: { label: "Done", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", icon: CheckCircle2 },
  todo: { label: "To do", tone: "bg-primary/10 text-primary", icon: Circle },
  waiting: { label: "Not yet", tone: "bg-muted text-muted-foreground", icon: Clock },
  overdue: { label: "Overdue", tone: "bg-red-500/10 text-red-700 dark:text-red-400", icon: AlertTriangle },
};

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

/** Steps the person looking can act on now. */
export const actionsFor = (v: FirstDaysView) => v.steps.filter((s) => s.status !== "done" && s.can.length > 0).length;

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

function FileLink({ file, label }: { file: { name: string; url: string }; label: string }) {
  return (
    <a href={file.url} target="_blank" rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-primary hover:bg-muted">
      <FileText className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{label}: {file.name}</span>
    </a>
  );
}

/** A button that opens a file picker and hands the chosen file on. */
function UploadButton({ label, busy, onFile }: { label: string; busy: boolean; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" className="hidden" accept={DOC_ACCEPT}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
      <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}{label}
      </Button>
    </>
  );
}

function StepBody({ step, view }: { step: FirstDaysStep; view: FirstDaysView }) {
  const employeeId = view.employee._id;
  const can = (a: string) => step.can.includes(a);
  const confirmMine = useConfirmMySession();
  const confirmHead = useConfirmSessionAsHead();
  const handIn = useHandInHomework();
  const send = useSendHomework();
  const rolePlay = useSubmitRolePlay();
  const access = useSetToolAccess();
  const assign = useAssignClients();
  const callsDone = useCallsDone();
  const [watching, setWatching] = useState(false);
  const [link, setLink] = useState("");

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

    case "homework":
      return (
        <div className="flex flex-wrap items-center gap-2">
          {step.file ? <FileLink file={step.file} label="Homework" /> : !step.can.length && <span className="text-xs text-muted-foreground">Not sent yet.</span>}
          {(can("send") || can("replace")) && (
            <UploadButton label={can("replace") ? "Replace the homework" : "Send homework"} busy={send.isPending}
              onFile={(file) => send.mutate({ employeeId, file })} />
          )}
        </div>
      );

    case "homeworkResult":
      return (
        <div className="flex flex-wrap items-center gap-2">
          {step.file && <FileLink file={step.file} label="Handed in" />}
          {(can("upload") || can("replace")) && (
            <UploadButton label={can("replace") ? "Upload again" : "Upload your homework"} busy={handIn.isPending}
              onFile={(file) => handIn.mutate(file)} />
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
