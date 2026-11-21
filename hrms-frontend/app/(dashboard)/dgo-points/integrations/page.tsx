"use client";
import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowUpRight, CheckCircle2, ChevronDown, ChevronRight, Loader2, Play, Plug, XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useDgoIntegrations, useRunDgoKpi, dgoErrorMessage, formatPoints } from "@/hooks/useDgoPoints";
import { DgoGate, Notice, Spinner, TableWrap, dateTime, dayLabel, monthLabel, shiftMonth } from "@/components/dgo/shared";
import type { DgoIntegrationsView, DgoMe, DgoSyncRun, DgoSyncSource } from "@/types";

/*
 * Points Integrations: every feed into DGO Points — sales KPI points from Root's
 * daily tracker, monthly achiever figures from Root, collections from finance —
 * when each last ran, what it brought in, who couldn't be matched and what
 * failed. The KPI import can be run again for a day here; the other two run
 * from their own pages.
 */

/** Plain words for the counters a run reports. Anything new the server adds shows under its own key. */
const COUNT_LABEL: Record<string, string> = {
  facts: "In Root's tracker",
  awarded: "Paid",
  alreadyThere: "Already had it",
  belowTarget: "Under target",
  notInHrms: "Not found in HRMS",
  notInPilot: "Not in the pilot",
  monthClosed: "Month closed",
  capped: "Over the daily cap",
  budgetBlocked: "Budget used up",
  suggestions: "Review suggestions",
};

const SOURCE_SHORT: Record<DgoSyncSource, string> = {
  kpi: "Sales KPIs",
  achievers: "Monthly achievers",
  collections: "Collections",
};

/** A run's key is a day for the KPI import and a month for the others. */
const keyLabel = (run: Pick<DgoSyncRun, "key">) => (/^\d{4}-\d{2}-\d{2}$/.test(run.key) ? dayLabel(run.key) : /^\d{4}-\d{2}$/.test(run.key) ? monthLabel(run.key) : run.key);

export default function DgoIntegrationsPage() {
  return (
    <DgoGate allow={(me) => me.can.settingsView || me.can.budgetsView}>
      {(me) => <IntegrationsPage me={me} />}
    </DgoGate>
  );
}

function IntegrationsPage({ me }: { me: DgoMe }) {
  const { data, isLoading, error } = useDgoIntegrations();
  return (
    <div>
      <PageHeader
        title="Points Integrations"
        description="Where DGO Points gets its figures from, when each feed last ran, and what it couldn't use."
        icon={Plug}
      />
      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <Notice text={dgoErrorMessage(error, "The integrations couldn't be loaded. Try again in a moment.")} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-3">
            {data.sources.map((s) => <SourceCard key={s.key} source={s} canRunKpi={data.can.runKpi} me={me} />)}
          </div>
          <RecentRuns runs={data.runs} />
        </div>
      )}
    </div>
  );
}

function SourceCard({ source: s, canRunKpi, me }: { source: DgoIntegrationsView["sources"][number]; canRunKpi: boolean; me: DgoMe }) {
  const last = s.lastRun;
  const counts = last ? Object.entries(last.counts).filter(([, n]) => typeof n === "number") : [];
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold leading-tight">{s.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{s.schedule}</p>
        </div>
        {!s.configured ? (
          <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">Not set up</span>
        ) : last ? (
          <RunPill ok={last.ok} />
        ) : (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Not run yet</span>
        )}
      </div>

      {!s.configured && s.configHint && (
        <p className="flex gap-2 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{s.configHint}</span>
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Last run</dt>
        <dd className="text-right">{last ? `${dateTime(last.startedAt)} · ${keyLabel(last)}` : "—"}</dd>
        <dt className="text-muted-foreground">Last worked</dt>
        <dd className="text-right">{s.lastOkAt ? dateTime(s.lastOkAt) : "—"}</dd>
        <dt className="text-muted-foreground">Failures, last 7 days</dt>
        <dd className={cn("text-right tabular-nums", s.failuresLast7Days > 0 && "font-semibold text-red-600 dark:text-red-400")}>{s.failuresLast7Days}</dd>
      </dl>

      {counts.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-2">
          {counts.map(([k, n]) => (
            <div key={k} className="rounded-lg bg-muted/50 px-2 py-1.5">
              <p className="truncate text-[11px] text-muted-foreground">{COUNT_LABEL[k] ?? k}</p>
              <p className="text-sm font-semibold tabular-nums">{formatPoints(n)}</p>
            </div>
          ))}
        </div>
      )}

      {last && !last.ok && last.errors[0] && (
        <p className="flex gap-2 text-xs text-red-600 dark:text-red-400">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-words">{last.errors[0]}</span>
        </p>
      )}

      <div className="mt-auto space-y-2">
        {s.key === "kpi" && canRunKpi && s.configured && <RunKpi me={me} />}
        {s.where && (
          <Link href={s.where} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            Run it from its own page <ArrowUpRight className="h-3 w-3" />
          </Link>
        )}
      </div>
    </Card>
  );
}

/** Run the KPI import again for one day: this month or last, never after today. */
function RunKpi({ me }: { me: DgoMe }) {
  const today = me.today;
  const earliest = `${shiftMonth(today.slice(0, 7), -1)}-01`;
  const [day, setDay] = useState(today);
  const [result, setResult] = useState<string | null>(null);
  const run = useRunDgoKpi();
  const bad = !day || day > today || day < earliest;
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-2">
      <Label htmlFor="dgo-kpi-day" className="text-xs">Run again for a day</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="dgo-kpi-day"
          type="date"
          value={day}
          min={earliest}
          max={today}
          onChange={(e) => { setDay(e.target.value); setResult(null); }}
          className="h-9 sm:flex-1"
        />
        <Button
          size="sm"
          className="h-9"
          disabled={bad || run.isPending}
          onClick={() => run.mutate(day, { onSuccess: (out) => setResult(out.message) })}
        >
          {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          Run
        </Button>
      </div>
      {bad && day && <p className="text-[11px] text-amber-700 dark:text-amber-400">Pick a day this month or last month, not after today.</p>}
      {result && <p className="text-xs text-muted-foreground">{result}</p>}
      <p className="text-[11px] text-muted-foreground">Nobody is paid twice: a day already paid is left as it is, and a KPI met can still become KPI exceeded.</p>
    </div>
  );
}

function RunPill({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
      <CheckCircle2 className="h-3 w-3" /> Worked
    </span>
  ) : (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-400">
      <XCircle className="h-3 w-3" /> Failed
    </span>
  );
}

function RecentRuns({ runs }: { runs: DgoSyncRun[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card className="p-0">
      <div className="border-b px-4 py-3">
        <p className="font-semibold">Recent runs</p>
        <p className="text-xs text-muted-foreground">The last 30, newest first. Open one to see who couldn&apos;t be paid and why.</p>
      </div>
      {runs.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">Nothing has run yet.</p>
      ) : (
        <ul className="divide-y">
          {runs.map((r) => {
            const isOpen = open === r.id;
            const paid = r.counts.awarded;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : r.id)}
                  className="flex w-full items-start gap-2 px-4 py-3 text-left hover:bg-muted/40"
                  aria-expanded={isOpen}
                >
                  {isOpen ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium">{SOURCE_SHORT[r.source] ?? r.source}</span>
                      <span className="text-xs text-muted-foreground">for {keyLabel(r)}</span>
                      <RunPill ok={r.ok} />
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{r.trigger === "nightly" ? "Nightly" : `By ${r.byName ?? "someone"}`}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {dateTime(r.startedAt)}
                      {typeof paid === "number" && ` · ${formatPoints(paid)} paid`}
                      {r.unmatched.length > 0 && ` · ${r.unmatched.length} not used`}
                      {r.errors.length > 0 && ` · ${r.errors.length} error${r.errors.length === 1 ? "" : "s"}`}
                    </p>
                  </div>
                </button>
                {isOpen && <RunDetail run={r} />}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function RunDetail({ run: r }: { run: DgoSyncRun }) {
  const counts = Object.entries(r.counts);
  return (
    <div className="space-y-3 bg-muted/20 px-4 pb-4 pt-1 text-sm">
      {counts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {counts.map(([k, n]) => (
            <span key={k} className="rounded-full bg-background px-2.5 py-1 text-xs ring-1 ring-border">
              {COUNT_LABEL[k] ?? k}: <span className="font-semibold tabular-nums">{formatPoints(n)}</span>
            </span>
          ))}
        </div>
      )}

      {r.errors.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-red-600 dark:text-red-400">What went wrong</p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs">
            {r.errors.map((e, i) => <li key={i} className="break-words">{e}</li>)}
          </ul>
        </div>
      )}

      {r.problems.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">What Root reported</p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs">
            {r.problems.map((p, i) => <li key={i} className="break-words">{p}</li>)}
          </ul>
        </div>
      )}

      {r.unmatched.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">Not paid ({r.unmatched.length})</p>
          <TableWrap className="rounded-lg border bg-background">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Person</th>
                  <th className="px-3 py-2 font-medium">CRM</th>
                  <th className="px-3 py-2 text-right font-medium">Achieved</th>
                  <th className="px-3 py-2 font-medium">Why</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {r.unmatched.map((u, i) => (
                  <tr key={`${u.email}-${i}`}>
                    <td className="px-3 py-1.5">
                      <p className="font-medium">{u.name || "—"}</p>
                      <p className="text-muted-foreground">{u.email}</p>
                    </td>
                    <td className="px-3 py-1.5 capitalize">{u.crm ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{u.achievedPct == null ? "—" : `${u.achievedPct}%`}</td>
                    <td className="px-3 py-1.5">{u.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      ) : (
        r.errors.length === 0 && <p className="text-xs text-muted-foreground">Everybody in it was used.</p>
      )}
      {r.finishedAt && <p className="text-[11px] text-muted-foreground">Finished {dateTime(r.finishedAt)}</p>}
    </div>
  );
}
