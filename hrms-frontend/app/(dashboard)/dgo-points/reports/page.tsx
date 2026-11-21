"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle, BarChart3, Check, CheckCircle2, ClipboardCheck, Download, FileBarChart, Hourglass, Loader2, Lock,
  Minus, Plus, Scale, Search, Send, X,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  useDgoReportsOverview, useDgoReconciliation, useDgoAdjustments, useProposeDgoAdjustment, useDgoAdjustmentStep, useDgoExport,
  newRequestId, formatAed, formatPoints, dgoErrorMessage,
} from "@/hooks/useDgoPoints";
import {
  DgoGate, DgoPersonSelect, MonthSwitcher, NoteDialog, Notice, PointsStatement, Spinner, Stat, TableWrap, UsageBar,
  dateTime, monthLabel,
} from "@/components/dgo/shared";
import type { DgoAdjustment, DgoAdjustmentsTab, DgoExportKind, DgoMe, DgoWaitingCount } from "@/types";

type Tab = "overview" | "reconciliation" | "adjustments";
const TABS: Tab[] = ["overview", "reconciliation", "adjustments"];

export default function DgoReportsPage() {
  // useSearchParams needs a boundary or the whole page opts out of static rendering.
  return (
    <Suspense fallback={<Spinner />}>
      <DgoGate allow={(me) => !!me.can.reportsView} deniedText="Points Reports is for finance, management and audit.">
        {(me) => <ReportsPage me={me} />}
      </DgoGate>
    </Suspense>
  );
}

function ReportsPage({ me }: { me: DgoMe }) {
  const router = useRouter();
  const params = useSearchParams();
  const thisMonth = me.today.slice(0, 7);
  const asked = params.get("tab") as Tab | null;
  const tab: Tab = asked && TABS.includes(asked) ? asked : "overview";
  const askedMonth = params.get("month");
  const [month, setMonth] = useState(askedMonth && /^\d{4}-\d{2}$/.test(askedMonth) && askedMonth <= thisMonth ? askedMonth : thisMonth);
  const go = (t: Tab, m = month) => {
    const q = new URLSearchParams();
    if (t !== "overview") q.set("tab", t);
    if (m !== thisMonth) q.set("month", m);
    router.replace(`/dgo-points/reports${q.toString() ? `?${q}` : ""}`, { scroll: false });
  };

  return (
    <div>
      <PageHeader
        title="Points Reports"
        description="Where every point came from and went: month by month, by department, and against the wallets."
        icon={FileBarChart}
        action={tab !== "adjustments" ? <MonthSwitcher month={month} onChange={(m) => { setMonth(m); go(tab, m); }} max={thisMonth} /> : undefined}
      />
      <Tabs
        layoutId="dgo-reports-tabs"
        value={tab}
        onChange={(k) => go(k as Tab)}
        tabs={[
          { key: "overview", label: "Overview", icon: BarChart3 },
          { key: "reconciliation", label: "Reconciliation", icon: Scale },
          { key: "adjustments", label: "Adjustments", icon: ClipboardCheck },
        ]}
      />
      {me.can.reportsExport && tab !== "adjustments" && <ExportBar month={month} />}
      {tab === "overview" ? <OverviewTab month={month} />
        : tab === "reconciliation" ? <ReconciliationTab month={month} pointValueAed={me.pointValueAed} />
          : <AdjustmentsTab me={me} />}
    </div>
  );
}

// ─── Exports ──────────────────────────────────────────────────────────────────

const EXPORTS: Array<{ kind: DgoExportKind; label: string }> = [
  { kind: "ledger", label: "Points log" },
  { kind: "wallets", label: "Wallets" },
  { kind: "redemptions", label: "Redemptions" },
  { kind: "reconciliation", label: "Reconciliation" },
];

function ExportBar({ month }: { month: string }) {
  const exp = useDgoExport();
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Download {monthLabel(month)} as CSV:</span>
      {EXPORTS.map((e) => {
        const busy = exp.isPending && exp.variables?.kind === e.kind;
        return (
          <Button key={e.kind} size="sm" variant="outline" disabled={exp.isPending} onClick={() => exp.mutate({ kind: e.kind, month })}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {e.label}
          </Button>
        );
      })}
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

const shortMonth = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });

function OverviewTab({ month }: { month: string }) {
  const { data: o, isLoading, error, isFetching } = useDgoReportsOverview(month);
  if (isLoading) return <Spinner />;
  if (error || !o) return <Notice text={dgoErrorMessage(error, "The report couldn't be loaded. Try again in a moment.")} />;
  const peak = Math.max(1, ...o.trend.map((t) => Math.max(t.issued, t.spent + t.expired + t.reversed)));

  return (
    <div className="space-y-6">
      <WaitingTiles w={o.waiting} />

      <Card>
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">The last six months</p>
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        {o.trend.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No points have moved yet.</p>
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Month</th>
                  <th className="w-40 px-4 py-2 font-medium">In / out</th>
                  <th className="px-4 py-2 text-right font-medium">Issued</th>
                  <th className="px-4 py-2 text-right font-medium">Spent</th>
                  <th className="px-4 py-2 text-right font-medium">Taken back</th>
                  <th className="px-4 py-2 text-right font-medium">Expired</th>
                  <th className="px-4 py-2 text-right font-medium">Adjusted</th>
                  <th className="px-4 py-2 text-right font-medium">Outstanding</th>
                  <th className="px-4 py-2 text-right font-medium">Owed (AED)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {o.trend.map((t) => {
                  const out = t.spent + t.expired + t.reversed;
                  return (
                    <tr key={t.month} className={cn(t.month === month && "bg-primary/5")}>
                      <td className="whitespace-nowrap px-4 py-2 font-medium">
                        {shortMonth(t.month)}
                        {t.closed && <Lock className="ml-1.5 inline h-3 w-3 text-muted-foreground" aria-label="Closed" />}
                      </td>
                      <td className="px-4 py-2">
                        <div className="space-y-1" title={`${formatPoints(t.issued)} in · ${formatPoints(out)} out`}>
                          <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${Math.max(2, (t.issued / peak) * 100)}%` }} />
                          <div className="h-1.5 rounded-full bg-orange-400" style={{ width: `${Math.max(2, (out / peak) * 100)}%` }} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatPoints(t.issued)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatPoints(t.spent)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatPoints(t.reversed)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatPoints(t.expired)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{t.adjusted > 0 ? "+" : t.adjusted < 0 ? "−" : ""}{formatPoints(Math.abs(t.adjusted))}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums">{formatPoints(t.closing)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatAed(t.liabilityAed)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <p className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-emerald-500" /> issued</span>
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-orange-400" /> spent, taken back or expired</span>
          <span className="flex items-center gap-1.5"><Lock className="h-3 w-3" /> month closed</span>
        </p>
      </Card>

      <Card>
        <p className="border-b border-border px-4 py-3 text-sm font-semibold">Departments in {monthLabel(month)}</p>
        {o.byDepartment.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">No allowances for this month yet.</p>
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Department</th>
                  <th className="px-4 py-2 font-medium">Group</th>
                  <th className="px-4 py-2 text-right font-medium">Points</th>
                  <th className="px-4 py-2 text-right font-medium">Allowance</th>
                  <th className="px-4 py-2 text-right font-medium">Used</th>
                  <th className="w-36 px-4 py-2 font-medium"><span className="sr-only">Usage</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {o.byDepartment.map((d) => (
                  <tr key={d.name}>
                    <td className="px-4 py-2 font-medium">{d.name}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{d.group === "revenue" ? "Revenue" : "Other"}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatPoints(d.points)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatAed(d.allocationAed)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatAed(d.committedAed)} <span className="text-xs text-muted-foreground">({Math.round(d.usedPct)}%)</span></td>
                    <td className="px-4 py-2"><UsageBar used={d.committedAed} of={d.allocationAed} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <SmallTable
          title="By rule"
          empty="Nothing earned this month."
          head={["Rule", "Times", "Points"]}
          rows={o.byRule.map((r) => [<span key="n">{r.name} <span className="font-mono text-[11px] text-muted-foreground">{r.code}</span></span>, formatPoints(r.count), formatPoints(r.points)])}
        />
        <SmallTable
          title="Top earners"
          empty="Nobody has earned points this month yet."
          head={["Person", "Points"]}
          rows={o.topEarners.map((p, i) => [
            <span key="n"><span className="mr-1.5 text-xs text-muted-foreground">{i + 1}.</span>{p.name}{p.department && <span className="block text-xs text-muted-foreground">{p.department}</span>}</span>,
            formatPoints(p.points),
          ])}
        />
        <SmallTable
          title="Rewards"
          empty="No rewards handed over this month."
          head={["Reward", "Times", "Points"]}
          rows={o.rewards.map((r) => [r.name, formatPoints(r.redeemed), formatPoints(r.points)])}
        />
      </div>
    </div>
  );
}

function WaitingTiles({ w }: { w: { earnings: DgoWaitingCount; redemptions: DgoWaitingCount; adjustments: DgoWaitingCount; overrides: DgoWaitingCount } }) {
  const tile = (label: string, c: DgoWaitingCount) => (
    <Stat
      label={label}
      value={formatPoints(c.count)}
      sub={c.count === 0 ? "nothing waiting" : c.oldestDays == null ? "waiting" : c.oldestDays === 0 ? "oldest from today" : `oldest ${c.oldestDays} day${c.oldestDays === 1 ? "" : "s"}`}
      tone={c.count > 0 && (c.oldestDays ?? 0) >= 2 ? "warn" : undefined}
      icon={Hourglass}
    />
  );
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tile("Points waiting for approval", w.earnings)}
      {tile("Rewards waiting for HR", w.redemptions)}
      {tile("Adjustments waiting", w.adjustments)}
      {tile("Overrides waiting", w.overrides)}
    </div>
  );
}

function SmallTable({ title, head, rows, empty }: { title: string; head: string[]; rows: React.ReactNode[][]; empty: string }) {
  return (
    <Card>
      <p className="border-b border-border px-4 py-3 text-sm font-semibold">{title}</p>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <TableWrap>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                {head.map((h, i) => <th key={h} className={cn("px-4 py-2 font-medium", i > 0 && "text-right")}>{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => <td key={j} className={cn("px-4 py-2", j > 0 && "whitespace-nowrap text-right tabular-nums")}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

// ─── Reconciliation ───────────────────────────────────────────────────────────

function ReconciliationTab({ month, pointValueAed }: { month: string; pointValueAed: number }) {
  const { data: r, isLoading, error, isFetching } = useDgoReconciliation(month);
  const [search, setSearch] = useState("");
  const people = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = r?.people ?? [];
    return s ? list.filter((p) => p.name.toLowerCase().includes(s) || (p.department ?? "").toLowerCase().includes(s)) : list;
  }, [r, search]);

  if (isLoading) return <Spinner />;
  if (error || !r) return <Notice text={dgoErrorMessage(error, "The reconciliation couldn't be loaded. Try again in a moment.")} />;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card className="space-y-3 p-4">
          <PointsStatement totals={r.totals} pointValueAed={pointValueAed} holds={r.equationHolds} title={`${monthLabel(month)}${r.closed ? " (closed)" : ""}`} />
          <p className="text-sm">Owed to staff at the end of the month: <span className="font-semibold tabular-nums">{formatAed(r.liabilityAed)}</span></p>
          {r.closed && r.snapshotMatches !== null && (
            <div className={cn(
              "flex items-start gap-2 rounded-lg p-3 text-xs",
              r.snapshotMatches ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : "bg-red-500/10 text-red-800 dark:text-red-300",
            )}>
              {r.snapshotMatches ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
              {r.snapshotMatches
                ? "Counting the month again today gives exactly the snapshot taken when it was closed."
                : "Counting the month again today doesn't match the snapshot taken when it was closed. Tell whoever looks after HRMS."}
            </div>
          )}
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </Card>

        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Wallets against the points log</p>
            <span className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
              r.wallets.matches ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-red-500/10 text-red-700 dark:text-red-400",
            )}>
              {r.wallets.matches ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              {r.wallets.matches ? "They match" : "They don't match"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-lg bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Points log says</p><p className="font-semibold tabular-nums">{formatPoints(r.wallets.ledgerOutstanding)}</p></div>
            <div className="rounded-lg bg-muted/60 p-3"><p className="text-xs text-muted-foreground">Wallets add up to</p><p className="font-semibold tabular-nums">{formatPoints(r.wallets.walletOutstanding)}</p></div>
          </div>
          <p className="text-xs text-muted-foreground">The whole organisation, as of now. The points log is the record; each wallet is a running total that is recounted from it every night.</p>
          {r.wallets.drifted.length > 0 && (
            <div className="space-y-1 text-xs">
              <p className="font-semibold text-red-700 dark:text-red-400">Out of step:</p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {r.wallets.drifted.map((d) => (
                  <li key={d.employeeId} className="flex justify-between gap-2 px-3 py-1.5">
                    <span>{d.name}</span>
                    <span className="tabular-nums text-muted-foreground">log {formatPoints(d.ledger)} · wallet {formatPoints(d.wallet)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Person by person</p>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or department" aria-label="Search people" />
          </div>
        </div>
        {people.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{r.people.length ? "Nobody matches." : "Nobody had points this month."}</p>
        ) : (
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Person</th>
                  <th className="px-4 py-2 text-right font-medium">Opening</th>
                  <th className="px-4 py-2 text-right font-medium">Issued</th>
                  <th className="px-4 py-2 text-right font-medium">Spent</th>
                  <th className="px-4 py-2 text-right font-medium">Taken back</th>
                  <th className="px-4 py-2 text-right font-medium">Expired</th>
                  <th className="px-4 py-2 text-right font-medium">Adjusted</th>
                  <th className="px-4 py-2 text-right font-medium">Closing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {people.map((p) => (
                  <tr key={p.employeeId}>
                    <td className="px-4 py-2">
                      <span className="font-medium">{p.name}</span>
                      {p.department && <span className="block text-xs text-muted-foreground">{p.department}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatPoints(p.opening)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatPoints(p.issued)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatPoints(p.spent)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatPoints(p.reversed)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatPoints(p.expired)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{p.adjusted > 0 ? "+" : p.adjusted < 0 ? "−" : ""}{formatPoints(Math.abs(p.adjusted))}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums">{formatPoints(p.closing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}

// ─── Adjustments ──────────────────────────────────────────────────────────────

const ADJ_TONE: Record<DgoAdjustment["status"], string> = {
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  rejected: "bg-red-500/10 text-red-700 dark:text-red-400",
};

/** Points added or removed by hand: proposed by one person in finance, approved by another. */
function AdjustmentsTab({ me }: { me: DgoMe }) {
  const [sub, setSub] = useState<DgoAdjustmentsTab>("pending");
  const { data, isLoading, error, isFetching } = useDgoAdjustments(sub);
  const decide = useDgoAdjustmentStep();
  const [proposing, setProposing] = useState(false);
  const [intent, setIntent] = useState<{ a: DgoAdjustment; step: "approve" | "reject" } | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-sm text-muted-foreground">
          An adjustment adds or removes points for one person — a correction, a refund after a month closed. It sits outside the department allowances and needs a second person in finance to approve it.
        </p>
        {me.can.adjustmentsPropose && <Button onClick={() => setProposing(true)}><Plus className="h-4 w-4" /> Propose an adjustment</Button>}
      </div>
      <Tabs
        layoutId="dgo-adjustment-tabs"
        value={sub}
        onChange={(k) => setSub(k as DgoAdjustmentsTab)}
        tabs={[
          { key: "pending", label: "Waiting", icon: Hourglass, count: data?.counts.pending },
          { key: "done", label: "Decided", icon: CheckCircle2, count: data?.counts.done },
        ]}
      />
      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <Notice text={dgoErrorMessage(error, "Adjustments couldn't be loaded. Try again in a moment.")} />
      ) : data.items.length === 0 ? (
        <Notice icon={ClipboardCheck} text={sub === "pending" ? "Nothing waiting." : "No adjustments decided yet."} />
      ) : (
        <div className="space-y-3">
          {isFetching && <div className="flex justify-end"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
          {data.items.map((a) => (
            <Card key={a.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{a.employee.name}</span>
                  {a.employee.department && <span className="text-xs text-muted-foreground">{a.employee.department}</span>}
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", ADJ_TONE[a.status])}>
                    {a.status === "pending" ? "Waiting for approval" : a.status === "approved" ? "Approved" : "Rejected"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">&ldquo;{a.reason}&rdquo; · proposed by {a.proposedByName ?? "finance"} · {dateTime(a.proposedAt)}</p>
                {a.decidedAt && (
                  <p className="text-xs text-muted-foreground">
                    {a.status === "approved" ? "Approved" : "Rejected"} by {a.decidedByName ?? "finance"} · {dateTime(a.decidedAt)}{a.decisionNote ? `: ${a.decisionNote}` : ""}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                <p className={cn("text-lg font-bold tabular-nums", a.points >= 0 ? "text-violet-700 dark:text-violet-400" : "text-red-600 dark:text-red-400")}>
                  {a.points >= 0 ? "+" : "−"}{formatPoints(Math.abs(a.points))} pts
                </p>
                {a.status === "pending" && a.canDecide && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" disabled={decide.isPending} onClick={() => setIntent({ a, step: "reject" })}><X className="h-4 w-4" /> Reject</Button>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={decide.isPending} onClick={() => setIntent({ a, step: "approve" })}><Check className="h-4 w-4" /> Approve</Button>
                  </div>
                )}
                {a.status === "pending" && !a.canDecide && a.whyNot && <p className="text-xs text-muted-foreground sm:text-right">{a.whyNot}</p>}
              </div>
            </Card>
          ))}
        </div>
      )}

      <ProposeAdjustmentDialog open={proposing} onOpenChange={setProposing} />
      <NoteDialog
        open={!!intent}
        onOpenChange={(o) => !o && setIntent(null)}
        title={intent?.step === "approve" ? "Approve this adjustment" : "Reject this adjustment"}
        description={
          intent
            ? intent.step === "approve"
              ? `${intent.a.points >= 0 ? "Adds" : "Removes"} ${formatPoints(Math.abs(intent.a.points))} points ${intent.a.points >= 0 ? "to" : "from"} ${intent.a.employee.name}'s wallet now. It shows in their points log as an adjustment.`
              : `Nothing changes in ${intent.a.employee.name}'s wallet. Say why.`
            : undefined
        }
        noteLabel={intent?.step === "reject" ? "Reason" : "Note (optional)"}
        requireNote={intent?.step === "reject"}
        confirmLabel={intent?.step === "approve" ? "Approve" : "Reject"}
        tone={intent?.step === "approve" ? "good" : "danger"}
        icon={intent?.step === "approve" ? Check : X}
        isPending={decide.isPending}
        onConfirm={(note) => intent && decide.mutate({ id: intent.a.id, step: intent.step, ...(note ? { note } : {}) }, { onSuccess: () => setIntent(null) })}
      />
    </div>
  );
}

function ProposeAdjustmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const propose = useProposeDgoAdjustment();
  const [employeeId, setEmployeeId] = useState("");
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState(newRequestId);
  useEffect(() => {
    if (!open) return;
    setEmployeeId("");
    setDirection("add");
    setPoints("");
    setReason("");
    setRequestId(newRequestId());
  }, [open]);

  const n = /^\d+$/.test(points.trim()) ? Number(points.trim()) : NaN;
  const problem =
    !employeeId ? "Choose the person"
      : !Number.isInteger(n) || n <= 0 ? "Enter a whole number of points"
        : n > 1_000_000 ? "That's more than 1,000,000 points"
          : !reason.trim() ? "Say why"
            : null;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Propose an adjustment</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
            A second person in finance approves it before anything changes. A removal can only take points the person can spend now.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Person</Label>
            <DgoPersonSelect value={employeeId} onChange={setEmployeeId} />
          </div>
          <div className="space-y-1.5">
            <Label>Add or remove</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["add", "remove"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    direction === d
                      ? d === "add" ? "border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-400" : "border-red-500 bg-red-500/10 text-red-700 dark:text-red-400"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {d === "add" ? <Plus className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                  {d === "add" ? "Add points" : "Remove points"}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dgo-adj-points">Points</Label>
            <Input id="dgo-adj-points" inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} placeholder="50" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dgo-adj-reason">Reason</Label>
            <Textarea id="dgo-adj-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="What it corrects, and where the evidence is" />
          </div>
        </div>
        <ResponsiveDialogFooter>
          {problem && <p className="mr-auto self-center text-xs text-muted-foreground">{problem}</p>}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={propose.isPending}>Cancel</Button>
          <Button
            disabled={!!problem || propose.isPending}
            onClick={() => propose.mutate(
              { employeeId, points: direction === "add" ? n : -n, reason: reason.trim(), requestId },
              { onSuccess: () => onOpenChange(false) },
            )}
          >
            {propose.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Propose
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
