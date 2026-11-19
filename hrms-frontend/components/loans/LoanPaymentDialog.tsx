"use client";
import { useEffect, useState } from "react";
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
import { useAddLoanPayment } from "@/hooks/useLoans";
import { todayAED } from "@/lib/utils";
import { LOAN_PAYMENT_METHOD_LABELS, type LoanHistory, type LoanPaymentMethod } from "@/types";
import { currencyOf, moneyIn } from "./loanFormat";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: LoanHistory;
}

/**
 * Money paid back outside payroll. It comes off what is left; the monthly
 * amount stays the same, so the loan simply finishes sooner.
 */
export function LoanPaymentDialog({ open, onOpenChange, history }: Props) {
  const { loan, summary } = history;
  const money = moneyIn(currencyOf(loan));
  const { mutate: add, isPending } = useAddLoanPayment();

  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayAED());
  const [method, setMethod] = useState<LoanPaymentMethod>("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setAmount(""); setDate(todayAED()); setMethod("cash"); setReference(""); setNote("");
  }, [open]);

  const n = Number(amount);
  const error =
    amount === "" ? null
    : !(n > 0) ? "Enter the amount paid"
    : n > summary.outstanding ? `Only ${money(summary.outstanding)} is left to pay`
    : null;
  const left = Math.round((summary.outstanding - (n > 0 ? n : 0)) * 100) / 100;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Record a direct payment</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Paid back in cash or by bank. It comes off the {money(summary.outstanding)} left; the monthly {money(summary.instalment)} stays the same, so the loan finishes sooner.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4 px-4 sm:px-0">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="loan-pay-amount">Amount</Label>
              <Input id="loan-pay-amount" type="number" inputMode="decimal" min={0} step="0.01" max={summary.outstanding} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loan-pay-date">Paid on</Label>
              <Input id="loan-pay-date" type="date" max={todayAED()} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          {error
            ? <p className="-mt-2 text-xs text-destructive">{error}</p>
            : n > 0 && <p className="-mt-2 text-xs text-muted-foreground">{left > 0 ? `${money(left)} left after this.` : "This clears the loan."}</p>}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as LoanPaymentMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(LOAN_PAYMENT_METHOD_LABELS) as LoanPaymentMethod[]).map((m) => (
                    <SelectItem key={m} value={m}>{LOAN_PAYMENT_METHOD_LABELS[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="loan-pay-ref">Receipt / reference</Label>
              <Input id="loan-pay-ref" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="loan-pay-note">Note</Label>
            <Textarea id="loan-pay-note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </div>
        </div>

        <ResponsiveDialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={isPending || !(n > 0) || !!error || !date}
            onClick={() => add(
              { id: loan._id, amount: n, date, method, reference: reference.trim() || undefined, note: note.trim() || undefined },
              { onSuccess: () => onOpenChange(false) }
            )}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}Record payment
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
