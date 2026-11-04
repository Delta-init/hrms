"use client";
import Link from "next/link";
import { ArrowUpRight, WalletCards } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useWallet } from "@/hooks/useWallet";
import { cn } from "@/lib/utils";
import type { Wallet } from "@/types";

/*
 * The wallet on the dashboard, first in its row (2026-11-04): this month so far — earned, deducted, paid, still to come
 * — and a way into the page. Drawn only for somebody who has a wallet; no employee record, no card.
 */

const money = (n: number, c: string) => `${c} ${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const thisMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date()).slice(0, 7);

export function headlineOf(w: Wallet): { label: string; figure: number } {
  if (w.status === "paid") return { label: "Paid in full", figure: w.totals.paid };
  if (w.status === "payslip" || w.status === "part_paid") return { label: "Still to be paid", figure: w.totals.balance };
  return { label: "Earned so far this month", figure: w.totals.net };
}

export function WalletCard({ className }: { className?: string }) {
  const { data: w } = useWallet(thisMonth());
  if (!w) return null;
  const c = w.currency;
  const h = headlineOf(w);
  const lost = w.days.filter((d) => d.counted).flatMap((d) => d.deductions).reduce((s, x) => s + x.days, 0);
  return (
    <Link href="/wallet" className={cn("block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", className)}>
      <Card className="p-5 transition-colors hover:border-primary/40 hover:bg-muted/40">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><WalletCards className="h-5 w-5" /></div>
            <div>
              <p className="text-xs text-muted-foreground">My wallet · {h.label.toLowerCase()}</p>
              <p className="text-2xl font-bold tracking-tight tabular-nums">{w.status === "paused" ? "—" : money(h.figure, c)}</p>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div><p className="text-muted-foreground">Credited</p><p className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">+{money(w.totals.credited, c)}</p></div>
          <div><p className="text-muted-foreground">Deducted</p><p className="font-semibold tabular-nums text-red-600 dark:text-red-400">−{money(w.totals.deducted, c)}</p></div>
          <div><p className="text-muted-foreground">Paid</p><p className="font-semibold tabular-nums">{money(w.totals.paid, c)}</p></div>
        </div>
        {lost > 0 && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{lost} day{lost === 1 ? "" : "s"} of pay lost this month — see why</p>}
      </Card>
    </Link>
  );
}
