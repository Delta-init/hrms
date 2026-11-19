"use client";
import { useState } from "react";
import { CalendarX2, HandCoins, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { useRemoveLoanPayment } from "@/hooks/useLoans";
import { cn, formatDate } from "@/lib/utils";
import { LOAN_PAYMENT_METHOD_LABELS, type LoanHistory, type LoanHistoryRow } from "@/types";
import { LoanMonthDialog } from "./LoanMonthDialog";
import { LoanPaymentDialog } from "./LoanPaymentDialog";
import { changeableMonths, currencyOf, monthLabel, moneyIn } from "./loanFormat";

const SLIP: Record<string, string> = { draft: "Draft payslip", issued: "Payslip issued", paid: "Payslip paid" };

/** What happened in a row, in words. */
function describe(r: LoanHistoryRow, money: (n: number) => string): { title: string; detail?: string; tone: string } {
  const slip = r.payslipStatus ? `${SLIP[r.payslipStatus] ?? r.payslipStatus}${r.imported ? " (salary sheet)" : ""}` : undefined;
  const why = r.plan?.reason ? ` — ${r.plan.reason}` : "";
  switch (r.kind) {
    case "opening": return { title: "Repaid before these records", detail: "Before HRMS payslips, or set on the loan by hand", tone: "text-muted-foreground" };
    case "correction": return { title: "Balance corrected by hand", detail: "Repaid was set lower on the loan", tone: "text-amber-600" };
    case "salary": return { title: "From salary", detail: slip, tone: "text-emerald-600" };
    case "partial": return { title: `Took less${why}`, detail: `${money(Math.max(0, r.planned - r.amount))} moved to the end · ${slip ?? ""}`, tone: "text-sky-600" };
    case "skipped": return { title: `Skipped${why}`, detail: `Nothing taken · ${slip ?? ""}`, tone: "text-amber-600" };
    case "waived": return { title: "Waived — approved request", detail: slip, tone: "text-amber-600" };
    case "short": return { title: "Pay didn't cover it all", detail: `The rest moved to the end${slip ? ` · ${slip}` : ""}`, tone: "text-amber-600" };
    case "none": return r.payslipStatus
      ? { title: "Nothing taken", detail: slip, tone: "text-muted-foreground" }
      : { title: "No payslip in HRMS", tone: "text-muted-foreground" };
    case "direct": {
      const p = r.payment!;
      const bits = [LOAN_PAYMENT_METHOD_LABELS[p.method] ?? p.method, formatDate(p.date), p.reference, p.note].filter(Boolean);
      return { title: "Paid directly", detail: bits.join(" · "), tone: "text-violet-600" };
    }
    case "upcoming":
      if (r.plan && r.plan.amount === 0) return { title: `Will skip${why}`, detail: "Nothing taken; the loan runs a month longer", tone: "text-amber-600" };
      if (r.plan) return { title: `Will take less${why}`, detail: `${money(Math.max(0, r.planned - r.amount))} moves to the end`, tone: "text-sky-600" };
      return { title: "Upcoming", tone: "text-muted-foreground" };
  }
}

interface Props {
  history: LoanHistory;
  /** The employee's own view: no changes. */
  readOnly?: boolean;
}

/**
 * Every month of a loan or salary advance: what was taken from salary, the
 * months skipped or reduced, money paid back directly, and what is still to
 * come — with HR's tools to change an upcoming month or record a payment.
 */
export function LoanHistoryView({ history, readOnly }: Props) {
  const { loan, summary, rows } = history;
  const money = moneyIn(currencyOf(loan));
  const { hasPermission } = useAuth();
  const canChange = !readOnly && hasPermission("loans", "edit") && loan.status !== "cancelled";
  const active = loan.status === "active";
  const { mutate: removePayment, isPending: removing } = useRemoveLoanPayment();

  const [monthOpen, setMonthOpen] = useState(false);
  const [monthPick, setMonthPick] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<LoanHistoryRow | null>(null);

  const pct = summary.amount > 0 ? Math.min(100, Math.round((summary.repaid / summary.amount) * 100)) : 0;
  const editable = changeableMonths(rows);
  const firstUpcoming = rows.findIndex((r) => r.kind === "upcoming");
  const breakdown = [
    summary.viaPayroll > 0 && `${money(summary.viaPayroll)} from salary`,
    summary.viaDirect > 0 && `${money(summary.viaDirect)} paid directly`,
    summary.before > 0 && `${money(summary.before)} before these records`,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Repaid" value={money(summary.repaid)} sub={`of ${money(summary.amount)} · ${pct}%`} />
        <Stat label="Left to pay" value={money(summary.outstanding)} />
        <Stat label="Monthly" value={money(summary.instalment)} sub={summary.next ? `Next: ${monthLabel(summary.next.month)}` : undefined} />
        <Stat
          label="Ends"
          value={active ? monthLabel(summary.endMonth) : loan.status === "closed" ? "Repaid" : "Cancelled"}
          sub={active && summary.monthsLeft ? `${summary.monthsLeft} month${summary.monthsLeft === 1 ? "" : "s"} left` : undefined}
        />
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
      {breakdown.length > 0 && <p className="text-xs text-muted-foreground">{breakdown.join(" · ")}</p>}
      {!summary.startMonth && active && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          This loan has no start date, so nothing is taken from salary until one is set.
        </p>
      )}

      {canChange && (active || editable.length > 0) && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!editable.length} onClick={() => { setMonthPick(null); setMonthOpen(true); }}>
            <CalendarX2 className="h-4 w-4" />Skip or reduce a month
          </Button>
          {summary.outstanding > 0 && (
            <Button size="sm" variant="outline" onClick={() => setPayOpen(true)}>
              <HandCoins className="h-4 w-4" />Record direct payment
            </Button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing has been taken yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <div className="hidden grid-cols-[88px_1fr_104px_96px_32px] gap-3 border-b bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid">
            <span>Month</span><span>What happened</span><span className="text-right">Amount</span><span className="text-right">Left</span><span />
          </div>
          {rows.map((r, i) => {
            const d = describe(r, money);
            const upcoming = r.kind === "upcoming";
            const changed = r.plan && r.amount !== r.planned;
            return (
              <div key={`${r.kind}-${r.month}-${r.payment?.id ?? i}`}>
                {i === firstUpcoming && (
                  <div className="border-b bg-muted/30 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Still to come</div>
                )}
                <div className={cn(
                  "grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-b px-3 py-2.5 text-sm last:border-b-0 sm:grid-cols-[88px_1fr_104px_96px_32px] sm:items-center",
                  upcoming && "bg-muted/10 text-muted-foreground"
                )}>
                  <span className="font-medium sm:font-normal">
                    {r.kind === "direct" ? monthLabel(r.month) : r.month ? monthLabel(r.month) : "—"}
                  </span>
                  <span className="order-3 col-span-2 min-w-0 sm:order-none sm:col-span-1">
                    <span className={cn("font-medium", d.tone)}>{d.title}</span>
                    {d.detail && <span className="block truncate text-xs text-muted-foreground">{d.detail.replace(/ · $/, "")}</span>}
                  </span>
                  <span className="flex flex-col items-end whitespace-nowrap text-right tabular-nums">
                    <span className={cn(!upcoming && r.amount > 0 && "font-medium text-foreground")}>{r.kind === "correction" ? `+${money(r.amount)}` : money(r.amount)}</span>
                    {changed && <span className="text-[11px] text-muted-foreground line-through" title="The normal monthly amount">{money(r.planned)}</span>}
                  </span>
                  <span className="hidden text-right tabular-nums sm:block">{money(r.balance)}</span>
                  <span className="hidden justify-end sm:flex">
                    {canChange && r.changeable && r.month && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Skip or change this month" onClick={() => { setMonthPick(r.month); setMonthOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canChange && r.kind === "direct" && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Remove this payment" onClick={() => setRemoveTarget(r)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </span>
                  {/* Phones: the left balance and the actions under the description. */}
                  <span className="order-4 col-span-2 flex items-center justify-between text-xs text-muted-foreground sm:hidden">
                    <span>{money(r.balance)} left</span>
                    <span className="flex gap-1">
                      {canChange && r.changeable && r.month && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setMonthPick(r.month); setMonthOpen(true); }}>Change</Button>
                      )}
                      {canChange && r.kind === "direct" && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={() => setRemoveTarget(r)}>Remove</Button>
                      )}
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canChange && (
        <>
          <LoanMonthDialog open={monthOpen} onOpenChange={setMonthOpen} history={history} month={monthPick} />
          <LoanPaymentDialog open={payOpen} onOpenChange={setPayOpen} history={history} />
          <ConfirmDialog
            open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}
            title="Remove this payment"
            description={removeTarget ? `${money(removeTarget.amount)} paid directly will be owed again.` : ""}
            isPending={removing}
            onConfirm={() => removeTarget?.payment && removePayment(
              { id: loan._id, paymentId: removeTarget.payment.id },
              { onSuccess: () => setRemoveTarget(null) }
            )}
          />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
