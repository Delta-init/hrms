"use client";
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePlanLoanMonth, useClearLoanMonth } from "@/hooks/useLoans";
import { cn } from "@/lib/utils";
import type { LoanHistory } from "@/types";
import { changeableMonths, currencyOf, monthLabel, moneyIn } from "./loanFormat";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: LoanHistory;
  /** Open on this month. */
  month?: string | null;
}

/**
 * Skip a month or take less in it. The monthly amount never changes: what the
 * month doesn't take moves to the end of the loan.
 */
export function LoanMonthDialog({ open, onOpenChange, history, month: initial }: Props) {
  const { loan, summary, rows } = history;
  const money = moneyIn(currencyOf(loan));
  const months = useMemo(() => changeableMonths(rows), [rows]);
  const { mutate: plan, isPending: saving } = usePlanLoanMonth();
  const { mutate: clear, isPending: clearing } = useClearLoanMonth();

  const [month, setMonth] = useState("");
  const [mode, setMode] = useState<"skip" | "less">("skip");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const row = months.find((r) => r.month === month);
  const existing = (loan.monthPlans ?? []).find((p) => p.month === month);

  useEffect(() => {
    if (!open) return;
    const m = initial && months.some((r) => r.month === initial) ? initial : months[0]?.month ?? "";
    const p = (loan.monthPlans ?? []).find((x) => x.month === m);
    setMonth(m);
    setMode(p && p.amount > 0 ? "less" : "skip");
    setAmount(p && p.amount > 0 ? String(p.amount) : "");
    setReason(p?.reason ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const n = Number(amount);
  const amountError =
    mode === "less" && amount !== "" && (!(n > 0) || n >= summary.instalment)
      ? `Enter more than 0 and less than the monthly ${money(summary.instalment)}`
      : null;
  const canSave = !!month && !saving && (mode === "skip" || (amount !== "" && !amountError));

  const save = () =>
    plan(
      { id: loan._id, month, amount: mode === "skip" ? 0 : n, reason: reason.trim() || undefined },
      { onSuccess: () => onOpenChange(false) }
    );

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Skip or reduce a month</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            The monthly {money(summary.instalment)} stays the same — whatever a month doesn&apos;t take moves to the end of the loan.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Month</Label>
            <Select value={month} onValueChange={(m) => {
              setMonth(m);
              const p = (loan.monthPlans ?? []).find((x) => x.month === m);
              setMode(p && p.amount > 0 ? "less" : "skip");
              setAmount(p && p.amount > 0 ? String(p.amount) : "");
              setReason(p?.reason ?? "");
            }}>
              <SelectTrigger><SelectValue placeholder="Pick a month" /></SelectTrigger>
              <SelectContent>
                {months.map((r) => (
                  <SelectItem key={r.month} value={r.month!}>
                    {monthLabel(r.month)}{r.payslipStatus === "draft" ? " · draft payslip" : ""}{r.plan ? (r.plan.amount > 0 ? " · reduced" : " · skipped") : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {row?.payslipStatus === "draft" && (
              <p className="text-xs text-muted-foreground">{monthLabel(month)} already has a draft payslip — it is recalculated straight away.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {(["skip", "less"] as const).map((m) => (
              <button
                key={m} type="button" onClick={() => setMode(m)}
                className={cn(
                  "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  mode === m ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"
                )}
              >
                <p className="font-medium">{m === "skip" ? "Skip the month" : "Take less"}</p>
                <p className="text-xs text-muted-foreground">{m === "skip" ? "Nothing taken; ends a month later" : "The rest moves to the end"}</p>
              </button>
            ))}
          </div>

          {mode === "less" && (
            <div className="space-y-1.5">
              <Label htmlFor="loan-month-amount">Amount to take in {monthLabel(month)}</Label>
              <Input id="loan-month-amount" type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`Less than ${summary.instalment}`} />
              {amountError
                ? <p className="text-xs text-destructive">{amountError}</p>
                : n > 0 && <p className="text-xs text-muted-foreground">{money(Math.round((summary.instalment - n) * 100) / 100)} moves to the end of the loan.</p>}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="loan-month-reason">Reason</Label>
            <Textarea id="loan-month-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why — shown in the loan's history" />
          </div>
        </div>

        <ResponsiveDialogFooter className="gap-2">
          {existing && (
            <Button
              variant="outline" className="sm:mr-auto" disabled={clearing}
              onClick={() => clear({ id: loan._id, month }, { onSuccess: () => onOpenChange(false) })}
            >
              {clearing && <Loader2 className="h-4 w-4 animate-spin" />}Back to normal
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!canSave}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}{mode === "skip" ? "Skip month" : "Save amount"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
