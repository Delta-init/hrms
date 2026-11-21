"use client";
import { useState } from "react";
import {
  Award, Check, Gauge, HeartHandshake, Lightbulb, Loader2, MessageSquareHeart, Sparkles, TrendingUp, Trophy, Wrench, X,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useDgoRules, useDgoSuggestions, useRecordDgoSuggestion, useDismissDgoSuggestion, formatAed, formatPoints, dgoErrorMessage,
} from "@/hooks/useDgoPoints";
import { DgoGate, NoteDialog, Notice, Spinner, STAGE_LABEL, dayLabel } from "@/components/dgo/shared";
import type { DgoMe, DgoRule, DgoSuggestion, DgoSuggestionsTab } from "@/types";

/** An icon per known rule; anything new an admin adds gets the plain award. */
const ICONS: Record<string, React.ElementType> = {
  KPI_MET: Gauge,
  KPI_EXCEEDED: TrendingUp,
  STUDENT_FEEDBACK: MessageSquareHeart,
  TEAM_SUPPORT: HeartHandshake,
  ISSUE_RESOLVED: Wrench,
  PROCESS_IMPROVEMENT: Sparkles,
  INNOVATION: Lightbulb,
};

function whoConfirms(rule: DgoRule): string {
  if (!rule.chain.length) {
    return rule.source === "kpi" ? "Added once your KPI for the day is confirmed" : "Added as soon as it is recorded";
  }
  return `Approved by ${rule.chain.map((s) => STAGE_LABEL[s]).join(", then ")}`;
}

export default function DgoEarnPage() {
  return (
    <DgoGate allow={(me) => me.canUse}>
      {(me) => <EarnPage me={me} />}
    </DgoGate>
  );
}

function EarnPage({ me }: { me: DgoMe }) {
  const { data, isLoading, error } = useDgoRules();

  return (
    <div>
      <PageHeader
        title="Earn Points"
        description="What earns points, how many, and who confirms it."
        icon={Trophy}
      />
      {me.can.recordAwards && <Suggestions />}
      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <Notice text={dgoErrorMessage(error, "The rules couldn't be loaded. Try again in a moment.")} />
      ) : (
        <div className="space-y-4">
          <Card className="flex flex-wrap items-center gap-x-6 gap-y-1 p-4 text-sm">
            <span><span className="font-semibold">1 point</span> = {formatAed(data.settings.pointValueAed)}</span>
            <span>Up to <span className="font-semibold">{data.settings.dailyCap} points a day</span>, of which {data.settings.autoKpiCap} from KPIs</span>
            <span>Points expire after <span className="font-semibold">{data.settings.expiryMonths} months</span></span>
            <span className="text-xs text-muted-foreground">Rules version {data.settings.version}, from {dayLabel(data.settings.effectiveFrom)}</span>
          </Card>

          {data.rules.length === 0 ? (
            <Notice text="No rules are switched on yet." />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {data.rules.map((rule) => {
                const Icon = ICONS[rule.code] ?? Award;
                return (
                  <Card key={rule.code} className="flex gap-3 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-semibold leading-tight">{rule.name}</p>
                        <span className="shrink-0 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                          {rule.points} pts · {formatAed(rule.aed)}
                        </span>
                      </div>
                      {rule.description && <p className="text-sm text-muted-foreground">{rule.description}</p>}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
                        <span>{whoConfirms(rule)}</span>
                        {rule.needsEvidence && <span>Needs evidence</span>}
                        {rule.capExempt && <span>Outside the daily cap</span>}
                        {rule.kpiLevel === "exceeded" && <span>Replaces &ldquo;KPI met&rdquo; for the same day</span>}
                      </div>
                      <p className="font-mono text-[11px] text-muted-foreground">{rule.code}</p>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Every award also has to fit your department&apos;s budget for the month. If it is used up, new awards wait until next month.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Suggestions ──────────────────────────────────────────────────────────────

/**
 * Awards somebody may record in one click — today, verified 5-star student
 * reviews from the LMS. Recording one starts the usual request (department
 * head, then HR); dismissing it just puts it away.
 */
function Suggestions() {
  const [tab, setTab] = useState<DgoSuggestionsTab>("open");
  const { data, isLoading, error } = useDgoSuggestions(tab);
  const record = useRecordDgoSuggestion();
  const dismiss = useDismissDgoSuggestion();
  const [dismissing, setDismissing] = useState<DgoSuggestion | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);

  // Nothing to suggest and nothing done yet: say nothing at all.
  if (!isLoading && !error && data && data.counts.open === 0 && data.counts.done === 0) return null;

  return (
    <Card className="mb-4 space-y-3 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-amber-500" /> Suggestions</p>
          <p className="text-xs text-muted-foreground">Verified 5-star student reviews worth an award. Recording one sends it for approval as usual.</p>
        </div>
        <div className="inline-flex shrink-0 self-start rounded-lg bg-muted p-0.5 text-xs sm:self-auto">
          {(["open", "done"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn("rounded-md px-3 py-1 font-medium transition-colors", tab === k ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
              aria-pressed={tab === k}
            >
              {k === "open" ? "To look at" : "Done"}
              {data && <span className="ml-1 tabular-nums opacity-70">{data.counts[k]}</span>}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <Spinner className="py-6" />
      ) : error || !data ? (
        <p className="text-sm text-muted-foreground">{dgoErrorMessage(error, "The suggestions couldn't be loaded.")}</p>
      ) : data.items.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{tab === "open" ? "Nothing to look at right now." : "Nothing recorded or dismissed yet."}</p>
      ) : (
        <ul className="space-y-2">
          {data.items.map((s) => (
            <li key={s.id} className="rounded-xl border p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium leading-tight">{s.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.employee.name}{s.employee.department ? ` · ${s.employee.department}` : ""} · {dayLabel(s.day)}
                  </p>
                  {s.detail && (
                    <blockquote className="border-l-2 border-amber-400/60 pl-2 text-sm italic text-foreground/80 break-words">
                      &ldquo;{s.detail}&rdquo;
                    </blockquote>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {s.ruleName} · <span className="font-semibold text-amber-700 dark:text-amber-400">{formatPoints(s.points)} pts</span>
                  </p>
                </div>
                {s.status === "open" ? (
                  s.canRecord ? (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        disabled={record.isPending}
                        onClick={() => {
                          setRecordingId(s.id);
                          record.mutate(s.id, { onSettled: () => setRecordingId(null) });
                        }}
                      >
                        {record.isPending && recordingId === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Record
                      </Button>
                      <Button size="sm" variant="outline" disabled={dismiss.isPending} onClick={() => setDismissing(s)}>
                        <X className="h-4 w-4" /> Dismiss
                      </Button>
                    </div>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">For their head or HR to record</span>
                  )
                ) : (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      s.status === "recorded" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {s.status === "recorded" ? "Recorded" : "Dismissed"}{s.decidedByName ? ` by ${s.decidedByName}` : ""}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <NoteDialog
        open={!!dismissing}
        onOpenChange={(o) => { if (!o) setDismissing(null); }}
        title="Dismiss this suggestion?"
        description={dismissing ? `${dismissing.title} — it won't be suggested again.` : undefined}
        noteLabel="Why (optional)"
        confirmLabel="Dismiss"
        icon={X}
        isPending={dismiss.isPending}
        onConfirm={(note) => {
          if (!dismissing) return;
          dismiss.mutate({ id: dismissing.id, reason: note || undefined }, { onSuccess: () => setDismissing(null) });
        }}
      />
    </Card>
  );
}

