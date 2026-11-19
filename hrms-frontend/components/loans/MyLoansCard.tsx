"use client";
import { useState } from "react";
import { Banknote, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useMyLoans } from "@/hooks/useLoans";
import { cn } from "@/lib/utils";
import { LOAN_STATUS_LABELS } from "@/types";
import { LoanHistoryView } from "./LoanHistoryView";
import { currencyOf, monthLabel, moneyIn } from "./loanFormat";

/**
 * Your own loans and salary advances on your profile: what has been taken,
 * what is left, and every month — read-only. Nothing renders without one.
 */
export function MyLoansCard() {
  const { data } = useMyLoans();
  const [open, setOpen] = useState<string | null>(null);
  if (!data?.length) return null;

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <Banknote className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold">Loans &amp; advances</h2>
      </div>
      <div className="space-y-2">
        {data.map((h) => {
          const money = moneyIn(currencyOf(h.loan));
          const expanded = open === h.loan._id;
          const pct = h.summary.amount > 0 ? Math.min(100, Math.round((h.summary.repaid / h.summary.amount) * 100)) : 0;
          return (
            <div key={h.loan._id} className="rounded-lg border">
              <button type="button" className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setOpen(expanded ? null : h.loan._id)}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {h.loan.kind === "advance" ? "Salary advance" : "Loan"} · {money(h.summary.amount)}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">{LOAN_STATUS_LABELS[h.loan.status]}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {h.loan.status === "active"
                      ? `${money(h.summary.outstanding)} left${h.summary.endMonth ? ` · ends ${monthLabel(h.summary.endMonth)}` : ""}`
                      : "Fully repaid"}
                    {h.loan.purpose ? ` · ${h.loan.purpose}` : ""}
                  </p>
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
                </div>
                <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
              </button>
              {expanded && <div className="border-t p-3"><LoanHistoryView history={h} readOnly /></div>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
