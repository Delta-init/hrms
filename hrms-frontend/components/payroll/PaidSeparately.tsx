"use client";
import { Banknote } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useMyPaidSeparately } from "@/hooks/useOneTimeAdjustments";
import { cn } from "@/lib/utils";
import { ONE_TIME_FINANCE_STATUS_LABELS, type OneTimeFinanceStatus } from "@/types";

const TONE: Record<OneTimeFinanceStatus, string> = {
  with_finance: "border-violet-500/20 bg-violet-500/10 text-violet-600",
  paid: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600",
  rejected: "border-red-500/20 bg-red-500/10 text-red-600",
};
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "");

/**
 * Payments finance pays you directly — a bonus or commission HR sent to
 * finance rather than putting on a payslip. Listed beside the payslips so
 * nothing you were paid is missing from Payroll; drawn only when there is one.
 */
export function PaidSeparately() {
  const { data: rows = [] } = useMyPaidSeparately();
  if (!rows.length) return null;
  return (
    <Card className="p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><Banknote className="h-4 w-4 text-primary" />Paid separately</p>
      <div className="divide-y divide-border/60">
        {rows.map((r) => {
          const currency = (typeof r.employee === "object" && r.employee?.currency) || "AED";
          const status = r.financeStatus ?? "with_finance";
          return (
            <div key={r._id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">{r.label}</p>
                <p className="text-xs text-muted-foreground">
                  {status === "paid"
                    ? `Paid ${day(r.paidOn)}${r.paymentMethod ? ` · ${r.paymentMethod.replace(/_/g, " ")}` : ""}`
                    : status === "rejected" ? (r.financeNote || "Not paid") : "Waiting on finance"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold tabular-nums">{currency} {r.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium", TONE[status])}>{ONE_TIME_FINANCE_STATUS_LABELS[status]}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
