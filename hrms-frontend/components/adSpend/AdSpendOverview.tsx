"use client";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AdSpendOverview as Overview, AdSpendSettings } from "@/types";
import { money, monthLabel, swatch } from "./format";

interface Props {
  data: Overview | undefined;
  loading: boolean;
  settings: AdSpendSettings;
  canLog: boolean;
  onOpenWeek: (weekStart: string) => void;
}

function Card({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "warn" | "ok" | "bad" }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "warn" && "text-amber-600 dark:text-amber-400", tone === "bad" && "text-destructive")}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/**
 * Where the recruitment ad money went: month by month against the budget, by
 * platform against the candidates each brought in, and by role against what
 * its hiring request got out of it.
 */
export function AdSpendOverview({ data, loading, settings, canLog, onOpenWeek }: Props) {
  if (loading || !data) return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  const cur = data.currency;
  const order = data.platforms.map((p) => p.key);
  const labelOf = new Map(data.platforms.map((p) => [p.key, p.label]));
  const top = [...data.platforms].sort((a, b) => b.spend - a.spend)[0];
  const budget = data.monthlyBudget;
  const scale = Math.max(budget, ...data.months.map((m) => m.total), 1);
  const used = budget ? Math.round((data.thisMonth.spend / budget) * 100) : null;
  const last = data.lastWeek;

  return (
    <div className="space-y-6">
      {data.missing.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{data.missing.length}</strong> week{data.missing.length === 1 ? "" : "s"} not logged:{" "}
            {data.missing.slice(0, 4).map((w, i) => (
              <button key={w.weekStart} type="button" className="font-medium underline" onClick={() => onOpenWeek(w.weekStart)}>
                {w.label}{i < Math.min(data.missing.length, 4) - 1 ? ", " : ""}
              </button>
            ))}
            {data.missing.length > 4 ? ` and ${data.missing.length - 4} more` : ""}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card
          label={`${monthLabel(data.thisMonth.month, true)} so far`}
          value={money(data.thisMonth.spend, cur, 0)}
          tone={budget && data.thisMonth.spend > budget ? "bad" : undefined}
          sub={budget ? `${used}% of the ${money(budget, cur, 0)} budget` : "No monthly budget set"}
        />
        <Card
          label={`${monthLabel(data.from)} – ${monthLabel(data.to)}`}
          value={money(data.totals.spend, cur, 0)}
          sub={`${data.totals.weeksLogged} week${data.totals.weeksLogged === 1 ? "" : "s"} logged · ${data.roles.length} role${data.roles.length === 1 ? "" : "s"}`}
        />
        <Card
          label="Biggest platform"
          value={top && top.spend ? top.label : "—"}
          sub={top && top.spend && data.totals.spend ? `${Math.round((top.spend / data.totals.spend) * 100)}% of the spend` : "Nothing spent in this range"}
        />
        <Card
          label={`Last week · ${last.label}`}
          value={
            last.status === "logged" ? <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-5 w-5 text-emerald-500" />{money(last.total, cur, 0)}</span>
              : last.status === "nothing" ? "Nothing spent"
              : last.status === "missing" ? "Not logged"
              : "—"
          }
          tone={last.status === "missing" ? "warn" : undefined}
          sub={
            last.status === "missing" && canLog
              ? <Button size="sm" variant="outline" className="mt-1 h-7" onClick={() => onOpenWeek(last.weekStart)}>Log it now</Button>
              : last.status === "not_tracked" ? "Weekly reminders are off — set a start in Settings" : undefined
          }
        />
      </div>

      <section className="rounded-xl border p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Spend by month</h3>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {order.map((k, i) => (
              <span key={k} className="inline-flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-sm", swatch(i))} />{labelOf.get(k)}</span>
            ))}
            {budget > 0 && <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0 border-l-2 border-dashed border-foreground/50" />Budget {money(budget, cur, 0)}</span>}
          </div>
        </div>
        <div className="space-y-2.5">
          {data.months.map((m) => (
            <div key={m.month} className="grid grid-cols-[4.5rem_minmax(0,1fr)_7.5rem] items-center gap-3 text-sm">
              <span className="text-muted-foreground">{monthLabel(m.month)}</span>
              <div className="relative h-5 rounded bg-muted/50">
                <div className="flex h-full overflow-hidden rounded">
                  {order.map((k, i) => {
                    const v = m.byPlatform[k] ?? 0;
                    return v ? <div key={k} className={swatch(i)} style={{ width: `${(v / scale) * 100}%` }} title={`${labelOf.get(k)}: ${money(v, cur)}`} /> : null;
                  })}
                </div>
                {budget > 0 && <div className="absolute inset-y-[-3px] border-l-2 border-dashed border-foreground/50" style={{ left: `${(budget / scale) * 100}%` }} />}
              </div>
              <span className={cn("text-right tabular-nums", m.overBudget && "font-semibold text-destructive")}>{money(m.total, cur, 0)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold">By platform</h3>
          <p className="text-xs text-muted-foreground">Candidates are those added in the same months whose source is that platform.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr><th className="px-4 py-2 text-left font-medium">Platform</th><th className="px-4 py-2 text-right font-medium">Spend</th><th className="px-4 py-2 text-right font-medium">Share</th><th className="px-4 py-2 text-right font-medium">Candidates</th><th className="px-4 py-2 text-right font-medium">Cost per candidate</th></tr>
            </thead>
            <tbody>
              {data.platforms.map((p, i) => (
                <tr key={p.key} className="border-t">
                  <td className="px-4 py-2"><span className="inline-flex items-center gap-2"><span className={cn("h-2.5 w-2.5 rounded-sm", swatch(i))} />{p.label}{!p.active && <span className="text-xs text-muted-foreground">(retired)</span>}</span></td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(p.spend, cur)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{data.totals.spend ? `${Math.round((p.spend / data.totals.spend) * 100)}%` : "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{p.candidates}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{p.costPerCandidate != null ? money(p.costPerCandidate, cur) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold">By role</h3>
          <p className="text-xs text-muted-foreground">Applications and hires are counted for roles logged against a hiring request.</p>
        </div>
        {data.roles.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Nothing spent in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Role</th>
                  <th className="px-4 py-2 text-right font-medium">Spend</th>
                  <th className="px-4 py-2 text-left font-medium">Platforms</th>
                  <th className="px-4 py-2 text-right font-medium">Weeks</th>
                  <th className="px-4 py-2 text-right font-medium">Applications</th>
                  <th className="px-4 py-2 text-right font-medium">Hired</th>
                  <th className="px-4 py-2 text-right font-medium">Cost per hire</th>
                </tr>
              </thead>
              <tbody>
                {data.roles.map((r) => (
                  <tr key={r.key} className="border-t">
                    <td className="max-w-[18rem] px-4 py-2">
                      {r.requisition ? <Link href={`/hiring/${r.requisition._id}`} className="hover:underline">{r.role}</Link> : <span>{r.role}</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums">{money(r.total, cur)}</td>
                    <td className="px-4 py-2">
                      <div className="flex h-2 w-28 overflow-hidden rounded bg-muted/50" title={order.filter((k) => r.byPlatform[k]).map((k) => `${labelOf.get(k)} ${money(r.byPlatform[k], cur)}`).join(" · ")}>
                        {order.map((k, i) => (r.byPlatform[k] ? <div key={k} className={swatch(i)} style={{ width: `${(r.byPlatform[k] / r.total) * 100}%` }} /> : null))}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{r.weeks}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.applications ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.hired ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.costPerHire != null ? money(r.costPerHire, cur) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!settings.trackingFrom && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarClock className="h-4 w-4" />Weekly reminders start once HR sets from which week the log is owed, in Settings.
        </p>
      )}
    </div>
  );
}
