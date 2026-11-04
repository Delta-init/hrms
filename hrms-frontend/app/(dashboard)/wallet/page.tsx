"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, WalletCards } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { WalletView } from "@/components/wallet/WalletView";
import { EmployeeSelect } from "@/components/pickers";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** This month where the company keeps its books. */
const thisMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date()).slice(0, 7);
const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};
const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export default function WalletPage() {
  const { hasPermission } = useAuth();
  const canSeeOthers = hasPermission("payroll", "view");
  const [month, setMonth] = useState(thisMonth);
  const [employee, setEmployee] = useState("");
  const { data: w, isLoading, isFetching, error } = useWallet(month, employee || null);

  // Back as far as they've been employed, else a year; never past this month.
  const first = w?.firstMonth ?? shift(thisMonth(), -12);
  const message = (error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message;

  return (
    <div>
      <PageHeader
        title={employee && w ? `${w.employee.name}'s wallet` : "My Wallet"}
        description="Your pay a day at a time — what came off and why, your commission, and what finance has paid you."
        icon={WalletCards}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {canSeeOthers && (
              <EmployeeSelect value={employee} onChange={setEmployee} placeholder="Someone else's wallet" allowClear className="h-9 w-[210px]" />
            )}
            <div className="flex items-center rounded-lg border border-border">
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Previous month" disabled={month <= first} onClick={() => setMonth((m) => shift(m, -1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[8.5rem] text-center text-sm font-medium">{monthLabel(month)}</span>
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Next month" disabled={month >= thisMonth()} onClick={() => setMonth((m) => shift(m, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        }
      />
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : error || !w ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">{message ?? "Your wallet couldn't be loaded. Try again in a moment."}</Card>
      ) : (
        <WalletView w={w} />
      )}
    </div>
  );
}
