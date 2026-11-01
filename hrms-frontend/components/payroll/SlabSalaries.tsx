"use client";
import { useState } from "react";
import { Loader2, RefreshCw, TrendingUp, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSlabSalaries, useRefreshSlabSalaries, type SlabRefresh } from "@/hooks/usePayrollBatch";

/**
 * The CRM salary slabs for the month (the user, 2026-11-01: "the salary from the slab in HRMS, loss of pay on it").
 * Each salesperson's salary is what their CRM's slab pays for the month — Root works it out from Sales, Draw and Remote.
 * Refreshing reads it again and rebuilds those people's payslips on it; it can only be done while the month may still
 * be changed (a month with accounts is sent back first).
 */
const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const ROLE: Record<string, string> = { sales: "Sales Staff", tl: "Team Leader", sm: "Sales Manager" };

export function SlabSalaries({ month, canRefresh }: { month: string; canRefresh: boolean }) {
  const { data, isLoading } = useSlabSalaries(month);
  const refresh = useRefreshSlabSalaries();
  const [last, setLast] = useState<SlabRefresh | null>(null);
  const rows = data?.rows ?? [];

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold"><TrendingUp className="h-4 w-4 text-primary" /> CRM salary slabs</p>
          <p className="text-xs text-muted-foreground">
            A salesperson&apos;s salary for the month is their CRM slab&apos;s; loss of pay and penalties are priced off it.
            {data?.fetchedAt ? ` Last read from the CRMs ${new Date(data.fetchedAt).toLocaleString()}.` : " Not read for this month yet."}
          </p>
        </div>
        {canRefresh && (
          <Button size="sm" variant="outline" disabled={refresh.isPending}
            onClick={() => refresh.mutate(month, { onSuccess: (r) => setLast(r) })}>
            {refresh.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            Refresh from CRM slabs
          </Button>
        )}
      </div>

      {last && (last.unmatched.length > 0 || last.crmFailures.length > 0 || last.payslipsFailed.length > 0) && (
        <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs">
          {last.crmFailures.map((f) => (
            <p key={f.crm} className="flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" /> {f.crm}: {f.error} — its people keep what they had.</p>
          ))}
          {last.unmatched.length > 0 && (
            <p>No employee here with these emails, so no slab salary for them: {last.unmatched.map((u) => `${u.name} (${u.email || "no email"})`).join(", ")}.</p>
          )}
          {last.payslipsFailed.length > 0 && <p>{last.payslipsFailed.length} payslip(s) couldn&apos;t be rebuilt: {last.payslipsFailed.map((f) => f.error).join("; ")}</p>}
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No slab salaries for this month — payslips use each employee&apos;s contract salary.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">Employee</th>
                <th className="pb-2 pr-3 font-medium">CRM</th>
                <th className="pb-2 pr-3 font-medium">Position</th>
                <th className="pb-2 pr-3 font-medium">Slab</th>
                <th className="pb-2 pr-3 text-right font-medium">Salary</th>
                <th className="pb-2 text-right font-medium">Commission payable</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.email} className="border-b border-border/50 last:border-0">
                  <td className="py-2 pr-3">
                    <span className="font-medium">{r.employee?.name || r.name}</span>
                    <span className="block text-[11px] text-muted-foreground">{r.email}</span>
                  </td>
                  <td className="py-2 pr-3">{r.crmName || r.crm}</td>
                  <td className="py-2 pr-3">{ROLE[r.role] ?? r.role}</td>
                  <td className="py-2 pr-3"><Badge variant="secondary">{r.level}</Badge></td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right font-medium">{money(r.salary)}</td>
                  <td className="whitespace-nowrap py-2 text-right text-muted-foreground">{r.payable ? money(r.payable) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">Commission is paid by accounts through payroll, added to the payslip as &ldquo;Sales commission (CRM)&rdquo;.</p>
        </div>
      )}
    </Card>
  );
}
