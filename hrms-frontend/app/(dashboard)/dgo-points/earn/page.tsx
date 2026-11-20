"use client";
import { Award, Gauge, HeartHandshake, Lightbulb, MessageSquareHeart, Sparkles, TrendingUp, Trophy, Wrench } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { useDgoRules, formatAed, dgoErrorMessage } from "@/hooks/useDgoPoints";
import { DgoGate, Notice, Spinner, STAGE_LABEL, dayLabel } from "@/components/dgo/shared";
import type { DgoRule } from "@/types";

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
      {() => <EarnPage />}
    </DgoGate>
  );
}

function EarnPage() {
  const { data, isLoading, error } = useDgoRules();

  return (
    <div>
      <PageHeader
        title="Earn Points"
        description="What earns points, how many, and who confirms it."
        icon={Trophy}
      />
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
