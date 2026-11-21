"use client";
import { useEffect, useState } from "react";
import {
  AlertTriangle, Check, CheckCircle2, DownloadCloud, Landmark, Loader2, Lock, PiggyBank, Plus, RefreshCw, Save, Send,
  SlidersHorizontal, Undo2, Unlock, Users, X,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  useDgoBudget, useEnterDgoCollections, useConfirmDgoCollections, useRecountDgoBudget, useFetchDgoCollections,
  useDgoCloseStep, useProposeDgoOverride, useDgoOverrideStep,
  newRequestId, formatAed, formatPoints, dgoErrorMessage,
} from "@/hooks/useDgoPoints";
import {
  DgoGate, MonthSwitcher, NoteDialog, Notice, PointsStatement, Spinner, Stat, TableWrap, UsageBar, dateTime, monthLabel,
} from "@/components/dgo/shared";
import type { DgoBudgetView, DgoCollectionsBreakdown, DgoMe, DgoMonthClose, DgoOverride } from "@/types";

const STATUS_LABEL: Record<DgoBudgetView["status"], string> = {
  open: "Open",
  review: "Asked to close",
  finance_approved: "Finance approved",
  closed: "Closed",
};

export default function DgoBudgetsPage() {
  return (
    <DgoGate allow={(me) => me.can.budgetsView} deniedText="Budgets & Finance is for finance and management.">
      {(me) => <BudgetsPage me={me} />}
    </DgoGate>
  );
}

function BudgetsPage({ me }: { me: DgoMe }) {
  const thisMonth = me.today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const { data: b, isLoading, isFetching, error } = useDgoBudget(month);
  const recount = useRecountDgoBudget();

  return (
    <div>
      <PageHeader
        title="Points Budgets"
        description="The month's reward budget: set by confirmed collections, shared between revenue and other departments."
        icon={PiggyBank}
        action={<MonthSwitcher month={month} onChange={setMonth} max={thisMonth} busy={isFetching && !isLoading} />}
      />
      {isLoading ? (
        <Spinner />
      ) : error || !b ? (
        <Notice text={dgoErrorMessage(error, "The budget couldn't be loaded. Try again in a moment.")} />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-semibold",
              b.status === "open" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground",
            )}>{STATUS_LABEL[b.status]}</span>
            <span className="text-muted-foreground">Tier: <span className="font-medium text-foreground">{b.tierLabel}</span></span>
            <span className="text-xs text-muted-foreground">
              {b.tierBasis === "confirmed" ? "from this month's confirmed collections"
                : b.tierBasis === "previous_month" ? `from ${b.tierBasisMonth ? monthLabel(b.tierBasisMonth) : "last month"}'s confirmed collections, until this month is confirmed`
                  : "the lowest tier, until finance confirms a collections figure"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat
              label="Eligible collections"
              value={b.collections.confirmedAed != null ? formatAed(b.collections.confirmedAed) : "—"}
              sub={b.collections.confirmedAed != null ? "confirmed" : b.collections.awaitingConfirmation ? "entered, not yet confirmed" : "not entered"}
              icon={Landmark}
            />
            <Stat label="Tier" value={`${b.tierIndex + 1} of ${b.tiers.length}`} sub={b.tierLabel} />
            <Stat label="Everyday pool" value={formatAed(b.everydayAed)} sub={`${formatPoints(Math.round(b.everydayAed / b.pointValueAed))} points`} />
            <Stat
              label="Elite pool"
              value={b.eliteUnlocked ? formatAed(b.eliteAed) : "Locked"}
              sub={b.eliteUnlocked ? "unlocked" : "opens at the top tier"}
              tone={b.eliteUnlocked ? "gold" : "muted"}
              icon={b.eliteUnlocked ? Unlock : Lock}
            />
            <Stat label="Monthly ceiling" value={formatAed(b.ceilingAed)} sub="everyday + elite" />
          </div>

          <Card className="space-y-2 p-4">
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span className="font-semibold">Everyday pool used</span>
              <span className="tabular-nums">{formatAed(b.committedAed)} of {formatAed(b.everydayAed)} · <span className="font-medium">{formatAed(b.leftAed)} left</span></span>
            </div>
            <UsageBar used={b.committedAed} of={b.everydayAed} />
            <p className="text-xs text-muted-foreground">Finance is told at 80%, 90% and 100%. A department that has used its share gets no new awards this month.</p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <CollectionsBox b={b} month={month} />
            <Card className="space-y-3 p-4">
              <p className="text-sm font-semibold">How the everyday pool is shared</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {b.groups.map((g) => (
                  <div key={g.group} className="space-y-1.5 rounded-lg bg-muted/50 p-3">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium">{g.group === "revenue" ? "Revenue departments" : "Other departments"}</span>
                      <span className="text-muted-foreground">{g.sharePct}%</span>
                    </div>
                    <p className="text-lg font-bold tabular-nums">{formatAed(g.shareAed)}</p>
                    <UsageBar used={g.committedAed} of={g.shareAed} />
                    <p className="text-xs text-muted-foreground">{formatAed(g.committedAed)} used · {g.headcount} staff</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Inside each group, the share is split by active staff in each department.</p>
            </Card>
          </div>

          {b.close && <CloseCard b={b} close={b.close} month={month} />}

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4 text-muted-foreground" /> Department allowances</p>
              {b.can.recount && (
                <Button size="sm" variant="outline" disabled={recount.isPending} onClick={() => recount.mutate({ month })}>
                  {recount.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Recount staff
                </Button>
              )}
            </div>
            {b.departments.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No departments yet.</p>
            ) : (
              <TableWrap>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Department</th>
                      <th className="px-4 py-2 font-medium">Group</th>
                      <th className="px-4 py-2 text-right font-medium">Staff</th>
                      <th className="px-4 py-2 text-right font-medium">Allowance</th>
                      <th className="px-4 py-2 text-right font-medium">Used</th>
                      <th className="px-4 py-2 text-right font-medium">Left</th>
                      <th className="w-32 px-4 py-2 font-medium"><span className="sr-only">Usage</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {b.departments.map((d) => (
                      <tr key={d.id ?? "none"}>
                        <td className="px-4 py-2 font-medium">
                          {d.name}
                          {d.overrideAed != null && (
                            <span className="ml-2 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-400" title="An approved override sets this allowance">
                              Override
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{d.group === "revenue" ? "Revenue" : "Other"}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{d.headcount}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatAed(d.allocationAed)}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatAed(d.committedAed)}</td>
                        <td className={cn("whitespace-nowrap px-4 py-2 text-right font-medium tabular-nums", d.leftAed <= 0 && "text-red-600 dark:text-red-400")}>{formatAed(d.leftAed)}</td>
                        <td className="px-4 py-2"><UsageBar used={d.committedAed} of={d.allocationAed} /></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border font-semibold">
                      <td className="px-4 py-2" colSpan={2}>Total</td>
                      <td className="px-4 py-2 text-right tabular-nums">{b.departments.reduce((n, d) => n + d.headcount, 0)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatAed(b.departments.reduce((n, d) => n + d.allocationAed, 0))}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatAed(b.departments.reduce((n, d) => n + d.committedAed, 0))}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatAed(b.departments.reduce((n, d) => n + d.leftAed, 0))}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </TableWrap>
            )}
          </Card>

          {b.overrides && <OverridesCard b={b} month={month} />}

          <Card>
            <p className="border-b border-border px-4 py-3 text-sm font-semibold">History</p>
            {b.history.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing has changed this month yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {b.history.map((h, i) => (
                  <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
                    <span>
                      <span className="font-medium">{h.action}</span>
                      {h.amountAed != null && <span className="tabular-nums"> · {formatAed(h.amountAed)}</span>}
                      {h.note && <span className="text-muted-foreground"> · {h.note}</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">{h.byName ?? "System"} · {dateTime(h.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <TierTable b={b} />
        </div>
      )}
    </div>
  );
}

/**
 * Entering and confirming the month's eligible collections. Two people: one
 * types it, a second confirms, and only a confirmed figure moves the tier.
 */
function CollectionsBox({ b, month }: { b: DgoBudgetView; month: string }) {
  const enter = useEnterDgoCollections();
  const confirm = useConfirmDgoCollections();
  const fetchFromFinance = useFetchDgoCollections();
  const c = b.collections;
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { setAmount(""); setNote(""); }, [month]);

  const parsed = Number(amount.replace(/,/g, ""));
  const valid = amount.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;

  return (
    <Card className="space-y-3 p-4">
      <p className="text-sm font-semibold">Eligible collections for {monthLabel(month)}</p>
      <p className="text-xs text-muted-foreground">
        Reconciled receipts, less refunds, reversals and VAT adjustments. Leave out pending POS settlements, unpaid invoices and duplicates.
      </p>

      {c.confirmedAed != null && (
        <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">{formatAed(c.confirmedAed)}</span> confirmed by {c.confirmedByName ?? "finance"} · {dateTime(c.confirmedAt)}
          </span>
        </div>
      )}

      {c.awaitingConfirmation && c.enteredAed != null && (
        <div className="space-y-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
          <p>
            <span className="font-semibold">{formatAed(c.enteredAed)}</span>{" "}
            {b.collectionsSource === "finance" ? "fetched from finance" : "entered"} by {c.enteredByName ?? "finance"} · {dateTime(c.enteredAt)}
            {c.note && <> · &ldquo;{c.note}&rdquo;</>}
          </p>
          <p>A second person in finance must confirm it before the tier changes.</p>
          {b.can.confirm && (
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={confirm.isPending} onClick={() => confirm.mutate({ month })}>
              {confirm.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Confirm {formatAed(c.enteredAed)}
            </Button>
          )}
        </div>
      )}

      {b.collectionsSource === "finance" && b.collectionsBreakdown && <BreakdownBox d={b.collectionsBreakdown} />}

      {b.can.fetchCollections && b.status !== "closed" && (
        <div className="space-y-1.5 rounded-lg border border-dashed border-border p-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={fetchFromFinance.isPending}
            onClick={() => fetchFromFinance.mutate({ month })}
          >
            {fetchFromFinance.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadCloud className="h-4 w-4" />}
            Get from finance
          </Button>
          <p className="text-xs text-muted-foreground">
            Asks the finance system for the month&apos;s payments received, less VAT. Its figure is entered for you — a second person in finance still confirms it.
          </p>
        </div>
      )}

      {b.can.enter && b.status !== "closed" && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            enter.mutate(
              { month, amountAed: parsed, ...(note.trim() ? { note: note.trim() } : {}) },
              { onSuccess: () => { setAmount(""); setNote(""); } },
            );
          }}
        >
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="space-y-1">
              <Label htmlFor="dgo-collections">Amount (AED)</Label>
              <Input id="dgo-collections" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1,245,000" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="dgo-collections-note">Note (optional)</Label>
              <Input id="dgo-collections-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Source or period" />
            </div>
          </div>
          <Button type="submit" size="sm" disabled={!valid || enter.isPending}>
            {enter.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {c.confirmedAed != null || c.awaitingConfirmation ? "Enter a new figure" : "Enter figure"}
          </Button>
        </form>
      )}
      {!b.can.enter && !b.can.confirm && c.confirmedAed == null && !c.awaitingConfirmation && (
        <p className="text-xs text-muted-foreground">Finance hasn&apos;t entered a figure for this month yet.</p>
      )}
    </Card>
  );
}

function TierTable({ b }: { b: DgoBudgetView }) {
  return (
    <Card>
      <p className="border-b border-border px-4 py-3 text-sm font-semibold">Revenue tiers</p>
      <TableWrap>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-4 py-2 font-medium">Eligible collections from</th>
              <th className="px-4 py-2 text-right font-medium">Everyday pool</th>
              <th className="px-4 py-2 text-right font-medium">Elite pool</th>
              <th className="px-4 py-2 text-right font-medium">Ceiling</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {b.tiers.map((t, i) => (
              <tr key={i} className={cn(i === b.tierIndex && "bg-primary/5 font-semibold")}>
                <td className="whitespace-nowrap px-4 py-2">{formatAed(t.minCollections)}{i === b.tierIndex && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">this month</span>}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatAed(t.everydayAed)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{t.eliteAed ? formatAed(t.eliteAed) : "locked"}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatAed(t.everydayAed + t.eliteAed)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

// ─── Collections from finance ─────────────────────────────────────────────────

function BreakdownBox({ d }: { d: DgoCollectionsBreakdown }) {
  const money = (v: number) => formatAed(v);
  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">From finance · {monthLabel(d.month)}</p>
        <p className="text-muted-foreground">worked out {dateTime(d.computedAt)}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md bg-muted/60 p-2"><p className="text-muted-foreground">Received</p><p className="font-semibold tabular-nums">{money(d.grossAed)}</p></div>
        <div className="rounded-md bg-muted/60 p-2"><p className="text-muted-foreground">VAT</p><p className="font-semibold tabular-nums">−{money(d.vatAed)}</p></div>
        <div className="rounded-md bg-emerald-500/10 p-2"><p className="text-muted-foreground">Net</p><p className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{money(d.netAed)}</p></div>
      </div>
      <ul className="space-y-1 text-muted-foreground">
        <li>{formatPoints(d.payments)} payments · {money(d.reconciledNetAed)} already on a bank statement, {money(d.unreconciledNetAed)} not yet</li>
        {d.pendingLateEntries.count > 0 && (
          <li>Left out: {d.pendingLateEntries.count} back-dated payment{d.pendingLateEntries.count === 1 ? "" : "s"} still waiting for approval ({money(d.pendingLateEntries.netAed)})</li>
        )}
        {d.creditNotes.count > 0 && (
          <li>For information: {d.creditNotes.count} credit note{d.creditNotes.count === 1 ? "" : "s"} issued ({money(d.creditNotes.totalAed)}) — they move no cash, so nothing is taken off</li>
        )}
        <li>Cash refunds aren&apos;t recorded in finance — lower the figure for any before confirming.</li>
      </ul>
      {d.byMethod.length > 0 && (
        <TableWrap>
          <table className="w-full">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Method</th>
                <th className="py-1 pr-3 text-right font-medium">Payments</th>
                <th className="py-1 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.byMethod.map((m) => (
                <tr key={m.method}>
                  <td className="py-1 pr-3">{m.method}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{formatPoints(m.count)}</td>
                  <td className="whitespace-nowrap py-1 text-right tabular-nums">{money(m.netAed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}

// ─── Month close ──────────────────────────────────────────────────────────────

const CLOSE_STEPS: Array<{ key: DgoMonthClose["status"]; label: string }> = [
  { key: "open", label: "Open" },
  { key: "review", label: "Asked to close" },
  { key: "closed", label: "Closed" },
];

/**
 * Closing a finished month: one person in finance asks, a second closes it. A
 * closed month keeps a snapshot and can't be reopened; later corrections land
 * in the month they're made, as adjustments.
 */
function CloseCard({ b, close, month }: { b: DgoBudgetView; close: DgoMonthClose; month: string }) {
  const step = useDgoCloseStep();
  const [intent, setIntent] = useState<"request" | "approve" | "cancel" | null>(null);
  const at = CLOSE_STEPS.findIndex((s) => s.key === close.status);
  const run = (note: string) => {
    if (!intent) return;
    step.mutate({ month, step: intent, ...(note ? { note } : {}) }, { onSuccess: () => setIntent(null) });
  };

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold"><Lock className="h-4 w-4 text-muted-foreground" /> Close the month</p>
        <div className="flex flex-wrap items-center gap-1">
          {CLOSE_STEPS.map((s, i) => (
            <span key={s.key} className="flex items-center gap-1">
              {i > 0 && <span className={cn("h-px w-4 sm:w-8", i <= at ? "bg-primary" : "bg-border")} />}
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  i < at ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : i === at ? (s.key === "closed" ? "bg-emerald-600 text-white" : "bg-primary text-primary-foreground")
                      : "bg-muted text-muted-foreground",
                )}
              >
                {(i < at || (i === at && s.key === "closed")) && <Check className="h-3 w-3" />}
                {s.label}
              </span>
            </span>
          ))}
        </div>
      </div>

      {close.status !== "closed" && (
        <p className="text-xs text-muted-foreground">
          Closing locks {monthLabel(month)}: nothing more is recorded into it or paid from it, and a snapshot of its totals is kept.
          One person in finance asks to close it and a second person closes it. A closed month can&apos;t be reopened.
        </p>
      )}

      {close.status === "review" && (
        <div className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
          Asked to close by <span className="font-semibold">{close.requestedByName ?? "finance"}</span> · {dateTime(close.requestedAt)}
          {close.requestNote && <> · &ldquo;{close.requestNote}&rdquo;</>}
          <p className="mt-1">A second person in finance closes it.</p>
        </div>
      )}

      {close.blockers.length > 0 && close.status !== "closed" && (
        <div className="space-y-1 rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 text-xs">
          <p className="flex items-center gap-1.5 font-semibold text-orange-700 dark:text-orange-400"><AlertTriangle className="h-3.5 w-3.5" /> Not ready to close yet</p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {close.blockers.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      )}

      {close.status !== "closed" && (close.can.request || close.can.approve || close.can.cancel) && (
        <div className="flex flex-wrap gap-2">
          {close.can.request && (
            <Button size="sm" disabled={step.isPending} onClick={() => setIntent("request")}><Send className="h-4 w-4" /> Ask to close</Button>
          )}
          {close.can.approve && (
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={step.isPending} onClick={() => setIntent("approve")}><Lock className="h-4 w-4" /> Close it</Button>
          )}
          {close.can.cancel && (
            <Button size="sm" variant="outline" disabled={step.isPending} onClick={() => setIntent("cancel")}><Undo2 className="h-4 w-4" /> Cancel the request</Button>
          )}
        </div>
      )}

      {close.status === "closed" && (
        <div className="rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300">
          Closed by <span className="font-semibold">{close.closedByName ?? "finance"}</span> · {dateTime(close.closedAt)}
          {close.requestedByName && <> · asked by {close.requestedByName}</>}
        </div>
      )}

      {close.status === "closed" && close.snapshot && <SnapshotView s={close.snapshot} pointValueAed={b.pointValueAed} month={month} />}

      <NoteDialog
        open={intent !== null}
        onOpenChange={(o) => !o && setIntent(null)}
        title={intent === "request" ? `Ask to close ${monthLabel(month)}` : intent === "approve" ? `Close ${monthLabel(month)}` : "Cancel the close request"}
        description={
          intent === "approve"
            ? <>This can&apos;t be reopened. Nothing more can be recorded into the month or paid from it, and later corrections become adjustments in the month they&apos;re made.</>
            : intent === "request"
              ? "A second person in finance then closes it."
              : "The month goes back to open. Say why."
        }
        noteLabel={intent === "cancel" ? "Reason" : "Note (optional)"}
        requireNote={intent === "cancel"}
        confirmLabel={intent === "request" ? "Ask to close" : intent === "approve" ? "Close the month" : "Cancel the request"}
        tone={intent === "approve" ? "good" : intent === "cancel" ? "danger" : "primary"}
        icon={intent === "request" ? Send : intent === "approve" ? Lock : Undo2}
        isPending={step.isPending}
        onConfirm={run}
      />
    </Card>
  );
}

function SnapshotView({ s, pointValueAed, month }: { s: NonNullable<DgoMonthClose["snapshot"]>; pointValueAed: number; month: string }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Points outstanding" value={formatPoints(s.points.closing)} sub={`≈ ${formatAed(s.liabilityAed)} owed to staff`} />
        <Stat label="Collections" value={s.collectionsAed != null ? formatAed(s.collectionsAed) : "—"} sub={s.tierLabel} />
        <Stat label="Everyday pool" value={formatAed(s.everydayAed)} />
        <Stat label="Elite pool" value={formatAed(s.eliteAed)} sub={`${formatAed(s.elitePaidAed)} paid in prizes`} />
      </div>
      <PointsStatement totals={s.points} pointValueAed={s.pointValueAed || pointValueAed} title={`Points in ${monthLabel(month)} (snapshot ${dateTime(s.takenAt)})`} />
      <p className="text-xs text-muted-foreground">
        {formatPoints(s.counts.earningsPosted)} earnings posted · {formatPoints(s.counts.nominationsPosted)} nominations · {formatPoints(s.counts.redemptionsFulfilled)} rewards delivered · {formatPoints(s.counts.adjustments)} adjustments
      </p>
      {s.departments.length > 0 && (
        <TableWrap>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Department</th>
                <th className="py-2 pr-4 font-medium">Group</th>
                <th className="py-2 pr-4 text-right font-medium">Allowance</th>
                <th className="py-2 text-right font-medium">Used</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {s.departments.map((d, i) => (
                <tr key={i}>
                  <td className="py-2 pr-4">
                    {d.name}
                    {d.overrideAed != null && <span className="ml-2 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:text-violet-400">Override</span>}
                  </td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground">{d.group === "revenue" ? "Revenue" : "Other"}</td>
                  <td className="whitespace-nowrap py-2 pr-4 text-right tabular-nums">{formatAed(d.allocationAed)}</td>
                  <td className="whitespace-nowrap py-2 text-right tabular-nums">{formatAed(d.committedAed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}

// ─── Allowance overrides ──────────────────────────────────────────────────────

const OVERRIDE_TONE: Record<DgoOverride["status"], string> = {
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  approved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  rejected: "bg-red-500/10 text-red-700 dark:text-red-400",
};

/** A different allowance for one department this month: proposed by one person in finance, approved by another. */
function OverridesCard({ b, month }: { b: DgoBudgetView; month: string }) {
  const decide = useDgoOverrideStep();
  const [proposing, setProposing] = useState(false);
  const [intent, setIntent] = useState<{ o: DgoOverride; step: "approve" | "reject" } | null>(null);
  const overrides = b.overrides ?? [];

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="h-4 w-4 text-muted-foreground" /> Allowance overrides</p>
        {b.can.proposeOverride && (
          <Button size="sm" variant="outline" onClick={() => setProposing(true)}><Plus className="h-4 w-4" /> Propose an override</Button>
        )}
      </div>
      {overrides.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          No overrides this month. An override gives one department a different allowance for the month; it needs a second person in finance to approve.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {overrides.map((o) => (
            <li key={o.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-0.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{o.department.name}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", OVERRIDE_TONE[o.status])}>
                    {o.status === "pending" ? "Waiting for approval" : o.status === "approved" ? "Approved" : "Rejected"}
                  </span>
                </div>
                <p className="tabular-nums">{formatAed(o.fromAed)} → <span className="font-semibold">{formatAed(o.toAed)}</span></p>
                <p className="text-xs text-muted-foreground">&ldquo;{o.reason}&rdquo; · proposed by {o.proposedByName ?? "finance"} · {dateTime(o.proposedAt)}</p>
                {o.decidedAt && (
                  <p className="text-xs text-muted-foreground">
                    {o.status === "approved" ? "Approved" : "Rejected"} by {o.decidedByName ?? "finance"} · {dateTime(o.decidedAt)}{o.decisionNote ? `: ${o.decisionNote}` : ""}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-1 sm:items-end">
                {o.status === "pending" && o.canDecide && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" disabled={decide.isPending} onClick={() => setIntent({ o, step: "reject" })}><X className="h-4 w-4" /> Reject</Button>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={decide.isPending} onClick={() => setIntent({ o, step: "approve" })}><Check className="h-4 w-4" /> Approve</Button>
                  </div>
                )}
                {o.status === "pending" && !o.canDecide && o.whyNot && <p className="text-xs text-muted-foreground sm:text-right">{o.whyNot}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ProposeOverrideDialog b={b} month={month} open={proposing} onOpenChange={setProposing} />
      <NoteDialog
        open={!!intent}
        onOpenChange={(o) => !o && setIntent(null)}
        title={intent?.step === "approve" ? "Approve this override" : "Reject this override"}
        description={intent ? `${intent.o.department.name}: ${formatAed(intent.o.fromAed)} → ${formatAed(intent.o.toAed)} for ${monthLabel(month)}.` : undefined}
        noteLabel={intent?.step === "reject" ? "Reason" : "Note (optional)"}
        requireNote={intent?.step === "reject"}
        confirmLabel={intent?.step === "approve" ? "Approve" : "Reject"}
        tone={intent?.step === "approve" ? "good" : "danger"}
        icon={intent?.step === "approve" ? Check : X}
        isPending={decide.isPending}
        onConfirm={(note) => intent && decide.mutate({ id: intent.o.id, step: intent.step, ...(note ? { note } : {}) }, { onSuccess: () => setIntent(null) })}
      />
    </Card>
  );
}

const NO_DEPT = "__none__";

function ProposeOverrideDialog({
  b, month, open, onOpenChange,
}: {
  b: DgoBudgetView;
  month: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const propose = useProposeDgoOverride();
  const [dept, setDept] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState(newRequestId);
  useEffect(() => {
    if (!open) return;
    setDept("");
    setAmount("");
    setReason("");
    setRequestId(newRequestId());
  }, [open]);

  const row = b.departments.find((d) => (d.id ?? NO_DEPT) === dept);
  const parsed = Number(amount.replace(/,/g, ""));
  const valid = amount.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;
  const problem =
    !row ? "Pick a department"
      : !valid ? "Enter the new allowance in AED"
        : row && parsed < row.committedAed ? `It can't be below what's already used (${formatAed(row.committedAed)})`
          : !reason.trim() ? "Say why"
            : null;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Propose an override</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
            A different allowance for one department in {monthLabel(month)}. A second person in finance approves it before it counts.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Department</Label>
            <Select value={dept} onValueChange={setDept}>
              <SelectTrigger><SelectValue placeholder="Choose a department…" /></SelectTrigger>
              <SelectContent>
                {b.departments.map((d) => (
                  <SelectItem key={d.id ?? NO_DEPT} value={d.id ?? NO_DEPT}>{d.id ? d.name : "No department"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {row && (
              <p className="text-xs text-muted-foreground">
                Now {formatAed(row.allocationAed)} · {formatAed(row.committedAed)} used · {formatAed(row.leftAed)} left
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dgo-ov-amount">New allowance (AED)</Label>
            <Input id="dgo-ov-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={row ? String(row.allocationAed) : "500"} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dgo-ov-reason">Reason</Label>
            <Textarea id="dgo-ov-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Why this department needs a different allowance this month" />
          </div>
        </div>
        <ResponsiveDialogFooter>
          {problem && <p className="mr-auto self-center text-xs text-muted-foreground">{problem}</p>}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={propose.isPending}>Cancel</Button>
          <Button
            disabled={!!problem || propose.isPending}
            onClick={() => row && propose.mutate(
              { month, departmentId: row.id, allocationAed: parsed, reason: reason.trim(), requestId },
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

