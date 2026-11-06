"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, Clock, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useInterviewResults } from "@/hooks/useHiring";
import { cn } from "@/lib/utils";
import {
  INTERVIEW_STATUS_LABELS, RECOMMENDATION_LABELS, STAGE_LABELS,
  type InterviewResult, type Recommendation,
} from "@/types";

export const RECOMMENDATION_TONE: Record<Recommendation, string> = {
  strong_yes: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  yes: "border-emerald-500/20 bg-emerald-500/5 text-emerald-600",
  no: "border-red-500/20 bg-red-500/5 text-red-600",
  strong_no: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
};

/** Green from 70, amber from 50, red below — a reading aid, not a pass mark. */
export const percentTone = (p: number | null) =>
  p == null ? "bg-muted text-muted-foreground"
    : p >= 70 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : p >= 50 ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
    : "bg-red-500/10 text-red-700 dark:text-red-400";

const fmtDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—";
const marks = (n: number | null) => (n == null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * The submitted interview sheets for a role — or for one of its candidates —
 * best-marked first. Each panellist's sheet stands on its own: a split panel is
 * the useful signal, and an average alone would hide it.
 */
export function InterviewResults({ requisitionId, applicationId, compact = false }: {
  requisitionId: string;
  applicationId?: string;
  /** One candidate on their own page: no candidate header. */
  compact?: boolean;
}) {
  const { data = [], isLoading } = useInterviewResults(requisitionId, applicationId);

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  const withInterviews = data.filter((r) => r.interviews.length);
  if (!withInterviews.length) {
    return compact
      ? <p className="text-xs text-muted-foreground">No interviews yet.</p>
      : <Card className="p-16 text-center text-muted-foreground">No interviews for this role yet.</Card>;
  }
  return (
    <div className="space-y-3">
      {withInterviews.map((r) => <CandidateResult key={r.application._id} result={r} compact={compact} />)}
    </div>
  );
}

function CandidateResult({ result, compact }: { result: InterviewResult; compact: boolean }) {
  const body = (
    <div className="space-y-3">
      {result.interviews.map((iv) => (
        <div key={iv._id} className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Round {iv.round}{iv.title ? ` · ${iv.title}` : ""} · {fmtDate(iv.scheduledAt)} · {INTERVIEW_STATUS_LABELS[iv.status]}
          </p>
          {iv.sheets.map((s) => <SheetRow key={s._id} sheet={s} />)}
          {iv.waitingOn.length > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <Clock className="h-3.5 w-3.5" />Waiting for {iv.waitingOn.join(", ")} to submit
            </p>
          )}
          {!iv.sheets.length && !iv.waitingOn.length && <p className="text-xs text-muted-foreground">No sheets.</p>}
        </div>
      ))}
    </div>
  );
  if (compact) return body;

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-medium">{result.candidate.name}</span>
        <span className="text-xs text-muted-foreground">
          {result.application.status === "active"
            ? STAGE_LABELS[result.application.stage]
            : result.application.status.charAt(0).toUpperCase() + result.application.status.slice(1)}
        </span>
        <span className={cn("ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold", percentTone(result.averagePercent))}>
          {result.averagePercent == null ? "Not marked yet" : `${result.averagePercent}% average`}
        </span>
        {(Object.entries(result.recommendations) as Array<[Recommendation, number]>).map(([rec, n]) => (
          <span key={rec} className={cn("rounded-full border px-2 py-0.5 text-[11px]", RECOMMENDATION_TONE[rec])}>
            {RECOMMENDATION_LABELS[rec]}{n > 1 ? ` ×${n}` : ""}
          </span>
        ))}
      </div>
      {body}
    </Card>
  );
}

function SheetRow({ sheet }: { sheet: InterviewResult["interviews"][number]["sheets"][number] }) {
  const [open, setOpen] = useState(false);
  const hasAnswers = sheet.answers.length > 0;
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        disabled={!hasAnswers && !sheet.notes}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm disabled:cursor-default"
      >
        {(hasAnswers || sheet.notes) && (open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />)}
        <span className="font-medium">{sheet.panellist.name}</span>
        {sheet.maxTotal != null && (
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", percentTone(sheet.percent))}>
            {marks(sheet.totalMarks)} / {sheet.maxTotal} ({sheet.percent}%)
          </span>
        )}
        {sheet.recommendation && (
          <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", RECOMMENDATION_TONE[sheet.recommendation])}>
            {RECOMMENDATION_LABELS[sheet.recommendation]}
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">{fmtDate(sheet.submittedAt)}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-3">
          {sheet.answers.map((a, i) => (
            <div key={a.questionId} className="grid gap-1 rounded-md bg-muted/30 p-2.5 text-sm sm:grid-cols-[1fr_auto]">
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{i + 1}. {a.question}</p>
                <p className="text-xs text-muted-foreground"><span className="font-medium">Expected:</span> {a.expectedAnswer}</p>
                <p className="whitespace-pre-wrap text-xs"><span className="font-medium">Said:</span> {a.response || "—"}</p>
              </div>
              <span className="self-start whitespace-nowrap text-sm font-semibold tabular-nums">{marks(a.marks)} / {a.maxMarks}</span>
            </div>
          ))}
          {sheet.notes && <p className="whitespace-pre-wrap text-xs text-muted-foreground"><span className="font-medium">Notes:</span> {sheet.notes}</p>}
        </div>
      )}
    </div>
  );
}
