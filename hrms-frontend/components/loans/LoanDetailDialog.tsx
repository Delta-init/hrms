"use client";
import { Loader2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { useLoanHistory } from "@/hooks/useLoans";
import { LOAN_STATUS_LABELS, type Loan } from "@/types";
import { LoanHistoryView } from "./LoanHistoryView";
import { currencyOf, moneyIn } from "./loanFormat";

interface Props {
  loan: Loan | null;
  onOpenChange: (open: boolean) => void;
}

/** A loan's month-by-month history, opened from the Loans page or an employee's Loans tab. */
export function LoanDetailDialog({ loan, onOpenChange }: Props) {
  const { data, isLoading, isError } = useLoanHistory(loan?._id);
  const emp = loan?.employee && typeof loan.employee === "object" ? loan.employee : null;
  const money = moneyIn(loan ? currencyOf(loan) : "");
  const what = loan?.kind === "advance" ? "Salary advance" : "Loan";

  return (
    <ResponsiveDialog open={!!loan} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-3xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{what} · {loan ? money(loan.amount) : ""}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {[emp?.name, loan?.purpose, loan ? LOAN_STATUS_LABELS[loan.status] : null].filter(Boolean).join(" · ")}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="px-4 pb-4 sm:px-0 sm:pb-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : isError || !data ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Couldn&apos;t load this loan&apos;s history.</p>
          ) : (
            <LoanHistoryView history={data} />
          )}
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
