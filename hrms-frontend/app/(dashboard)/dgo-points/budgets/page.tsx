"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Landmark, Loader2, Lock, PiggyBank, RefreshCw, Save, Unlock, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  useDgoBudget, useEnterDgoCollections, useConfirmDgoCollections, useRecountDgoBudget,
  formatAed, formatPoints, dgoErrorMessage,
} from "@/hooks/useDgoPoints";
import { DgoGate, MonthSwitcher, Notice, Spinner, Stat, TableWrap, UsageBar, dateTime, monthLabel } from "@/components/dgo/shared";
import type { DgoBudgetView, DgoMe } from "@/types";

const STATUS_LABEL: Record<DgoBudgetView["status"], string> = {
  open: "Open",
  review: "In review",
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
                        <td className="px-4 py-2 font-medium">{d.name}</td>
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
            <span className="font-semibold">{formatAed(c.enteredAed)}</span> entered by {c.enteredByName ?? "finance"} · {dateTime(c.enteredAt)}
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
