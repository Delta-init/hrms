"use client";
import { useState } from "react";
import {
  Loader2, Send, Undo2, Lock, AlertTriangle, Info, CheckCircle2, Building2,
} from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePayrollBatch, usePayrollPreflight, useSubmitPayroll, useRecallPayroll } from "@/hooks/usePayrollBatch";
import { PAYROLL_BATCH_LABELS, type PayrollBatchStatus, type PayrollCurrencyTotals } from "@/types";
import { cn } from "@/lib/utils";

const TONE: Record<PayrollBatchStatus, string> = {
  draft: "border-border bg-muted/40 text-muted-foreground",
  submitted: "border-sky-500/20 bg-sky-500/10 text-sky-700",
  in_finance: "border-sky-500/20 bg-sky-500/10 text-sky-700",
  approved: "border-violet-500/20 bg-violet-500/10 text-violet-700",
  partially_paid: "border-amber-500/20 bg-amber-500/10 text-amber-700",
  paid: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700",
  returned: "border-destructive/20 bg-destructive/10 text-destructive",
};

const money = (n: number, c: string) =>
  `${c} ${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A month's totals, one per currency.
 *
 * Falls back to the single headline figure when the server predates the
 * breakdown, so a frontend deployed ahead of its backend shows what it always
 * did rather than nothing.
 */
const currencyRows = (
  t: { currency?: string; employeeCount: number; grossTotal: number; deductionTotal: number; netTotal: number; byCurrency?: PayrollCurrencyTotals[] },
  fallbackCurrency: string
): PayrollCurrencyTotals[] =>
  t.byCurrency?.length
    ? t.byCurrency
    : t.employeeCount > 0
      ? [{ currency: t.currency ?? fallbackCurrency, employeeCount: t.employeeCount, grossTotal: t.grossTotal, deductionTotal: t.deductionTotal, netTotal: t.netTotal }]
      : [];

/** "AED 344,824.88 + INR 627,633.33" — each currency on its own, never one sum. */
const eachCurrency = (rows: PayrollCurrencyTotals[]) => rows.map((r) => money(r.netTotal, r.currency)).join(" + ");
const peopleIn = (rows: PayrollCurrencyTotals[]) => rows.reduce((n, r) => n + r.employeeCount, 0);

/**
 * Where this month stands between HR and accounts, and the one button that
 * moves it.
 *
 * Shown even when a month has never been submitted, because the absence of a
 * banner would be indistinguishable from a month nobody had looked at — and
 * "has this gone to accounts yet?" is the question the payroll screen exists
 * to answer once the handover is in place.
 */
export function PayrollHandover({ month, canSubmit }: { month: string; canSubmit: boolean }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [recallOpen, setRecallOpen] = useState(false);

  const { data: batch, isLoading } = usePayrollBatch(month);
  const preflight = usePayrollPreflight(month, confirmOpen);
  const { mutate: submit, isPending: submitting } = useSubmitPayroll();
  const { mutate: recall, isPending: recalling } = useRecallPayroll();

  if (isLoading || !batch) return null;

  const locked = !batch.editable;
  const canRecall = batch.status === "submitted";
  const bannerRows = currencyRows(batch, batch.currency);
  const confirmRows = preflight.data ? currencyRows(preflight.data.totals, batch.currency) : [];

  return (
    <>
      <Card className={cn("flex flex-wrap items-center gap-3 border p-3", TONE[batch.status])}>
        <div className="flex items-center gap-2">
          {locked ? <Lock className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
          <span className="text-sm font-semibold">{PAYROLL_BATCH_LABELS[batch.status]}</span>
        </div>

        <p className="text-xs opacity-90">
          {batch.status === "draft" && "HR still owns this month. Payslips can be edited."}
          {batch.status === "submitted" && `Handed to accounts${batch.submittedAt ? ` on ${new Date(batch.submittedAt).toLocaleDateString()}` : ""}. Payslips are locked.`}
          {batch.status === "in_finance" && "Accounts are adding their own payments and deductions. Payslips are locked."}
          {batch.status === "approved" && "Accounts have signed the figures off and are ready to pay. Payslips are locked."}
          {batch.status === "partially_paid" && "Some people have been paid, some have not."}
          {batch.status === "paid" && `Everyone on this run has been paid${batch.paidAt ? ` on ${new Date(batch.paidAt).toLocaleDateString()}` : ""}.`}
          {batch.status === "returned" && (batch.returnReason || "Accounts sent this back for a correction. Payslips are editable again.")}
        </p>

        {/* Live while the month is still HR's, the submitted snapshot after —
            the server decides which. Each currency is totalled on its own. */}
        {bannerRows.length > 0 && (
          <span className="text-xs font-medium opacity-90">
            {peopleIn(bannerRows)} people · {eachCurrency(bannerRows)} net
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {canSubmit && batch.editable && (
            <Button size="sm" className="h-8 gap-2" onClick={() => setConfirmOpen(true)}>
              <Send className="h-3.5 w-3.5" />Submit to accounts
            </Button>
          )}
          {canSubmit && canRecall && (
            <Button variant="outline" size="sm" className="h-8 gap-2" onClick={() => setRecallOpen(true)}>
              <Undo2 className="h-3.5 w-3.5" />Recall
            </Button>
          )}
        </div>
      </Card>

      {/* ── Submit ──────────────────────────────────────────────────────── */}
      <ResponsiveDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <ResponsiveDialogContent desktopClassName="max-w-lg">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Submit {month} to accounts?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Any payslip still in draft is issued, and the month is locked. After this, corrections
              have to come back through accounts.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>

          <div className="space-y-3 px-4 py-2 text-sm sm:px-0">
            {preflight.isLoading && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />Checking the month…
              </div>
            )}

            {preflight.data && (
              <>
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">People</span>
                    <span className="font-medium tabular-nums">{peopleIn(confirmRows)}</span>
                  </div>
                  {/* One line per currency. These were added into one figure and
                      shown as AED — rupees presented as dirhams, on the screen
                      somebody confirms before the month is locked. */}
                  <div className="mt-1 flex items-start justify-between gap-4">
                    <span className="text-muted-foreground">Net to pay</span>
                    <div className="text-right">
                      {confirmRows.map((r) => (
                        <div key={r.currency} className="font-semibold tabular-nums">
                          {money(r.netTotal, r.currency)}
                          {confirmRows.length > 1 && (
                            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                              · {r.employeeCount} {r.employeeCount === 1 ? "person" : "people"}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  {confirmRows.length > 1 && (
                    <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
                      Paid in {confirmRows.length} currencies. Each is totalled on its own — they are not added together.
                    </p>
                  )}
                </div>

                {preflight.data.blockers.map((b) => (
                  <p key={b} className="flex items-start gap-2 text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{b}</span>
                  </p>
                ))}

                {preflight.data.warnings.map((w) => (
                  <p key={w} className="flex items-start gap-2 text-amber-600">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{w}</span>
                  </p>
                ))}

                {preflight.data.canSubmit && preflight.data.warnings.length === 0 && (
                  <p className="flex items-start gap-2 text-emerald-600">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>Nothing outstanding. Ready to hand over.</span>
                  </p>
                )}
              </>
            )}
          </div>

          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button
              disabled={!preflight.data?.canSubmit || submitting}
              onClick={() => submit(month, { onSuccess: () => setConfirmOpen(false) })}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit to accounts
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* ── Recall ──────────────────────────────────────────────────────── */}
      <ResponsiveDialog open={recallOpen} onOpenChange={setRecallOpen}>
        <ResponsiveDialogContent desktopClassName="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Recall {month} from accounts?</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              The month goes back to draft and payslips become editable again. This only works while
              accounts have not started on it — once they have, ask them to send it back instead.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setRecallOpen(false)}>Cancel</Button>
            <Button
              disabled={recalling}
              onClick={() => recall(month, { onSuccess: () => setRecallOpen(false) })}
            >
              {recalling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              Recall
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
