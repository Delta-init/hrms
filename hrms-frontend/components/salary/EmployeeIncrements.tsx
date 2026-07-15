"use client";
import { useState } from "react";
import { TrendingUp, Plus, Pencil, Trash2 } from "lucide-react";
import { useSalaryIncrements, useDeleteSalaryIncrement } from "@/hooks/useSalaryIncrements";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SalaryIncrementDialog } from "@/components/salary/SalaryIncrementDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { cn } from "@/lib/utils";
import type { SalaryIncrement } from "@/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMonth = (m: string) => { const [y, mm] = m.split("-"); return `${MONTHS[Number(mm) - 1]} ${y}`; };

interface Props {
  employee: { _id: string; name: string; employeeCode?: string; salary?: number; currency?: string };
}

export function EmployeeIncrements({ employee }: Props) {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("salaryIncrements", "create");
  const canEdit = hasPermission("salaryIncrements", "edit");
  const canDelete = hasPermission("salaryIncrements", "delete");

  const { data, isLoading } = useSalaryIncrements({ employee: employee._id, limit: "50", sortBy: "effectiveMonth", sortOrder: "desc" });
  const rows = (data?.data ?? []) as SalaryIncrement[];
  const { mutate: remove, isPending: deleting } = useDeleteSalaryIncrement();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<SalaryIncrement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SalaryIncrement | null>(null);

  const cur = employee.currency ? employee.currency + " " : "";
  const money = (n: number) => `${cur}${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  if (isLoading) return <Card className="p-12 text-center text-sm text-muted-foreground">Loading…</Card>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <span className="text-muted-foreground">Current salary </span>
          <span className="font-semibold">{money(employee.salary ?? 0)}</span>
        </div>
        {canCreate && <Button size="sm" onClick={() => { setSelected(null); setDialogOpen(true); }}><Plus className="h-4 w-4" />New Increment</Button>}
      </div>

      {rows.length === 0 ? (
        <Card className="p-12 text-center">
          <TrendingUp className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No salary increments</p>
          <p className="mt-1 text-sm text-muted-foreground">Record a raise — payroll applies it from its effective month.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((i) => {
            const diff = i.newSalary - i.previousSalary;
            const pct = i.previousSalary > 0 ? (diff / i.previousSalary) * 100 : 0;
            return (
              <Card key={i._id} className="flex items-center gap-4 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600"><TrendingUp className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{money(i.previousSalary)} → {money(i.newSalary)} <span className={cn("ml-1 text-xs font-semibold", diff >= 0 ? "text-emerald-600" : "text-red-500")}>{diff >= 0 ? "+" : ""}{money(diff)}{i.previousSalary > 0 ? ` (${diff >= 0 ? "+" : ""}${pct.toFixed(1)}%)` : ""}</span></p>
                  <p className="text-xs text-muted-foreground">Effective {fmtMonth(i.effectiveMonth)}{i.reason ? ` · ${i.reason}` : ""}</p>
                </div>
                {canEdit && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setSelected(i); setDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button>}
                {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(i)}><Trash2 className="h-4 w-4" /></Button>}
              </Card>
            );
          })}
        </div>
      )}

      <SalaryIncrementDialog open={dialogOpen} onOpenChange={setDialogOpen} increment={selected} employee={selected ? null : employee} />
      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete increment" description="This salary increment will be permanently removed and payroll will revert to the prior salary." isPending={deleting}
        onConfirm={() => deleteTarget && remove(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) })}
      />
    </div>
  );
}
