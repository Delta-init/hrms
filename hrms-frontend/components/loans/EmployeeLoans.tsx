"use client";
import { useState } from "react";
import { Banknote, Plus, Pencil, Trash2 } from "lucide-react";
import { useLoans, useDeleteLoan } from "@/hooks/useLoans";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoanDialog } from "@/components/loans/LoanDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { cn } from "@/lib/utils";
import { LOAN_STATUS_LABELS, type Loan, type LoanStatus } from "@/types";

const statusStyles: Record<LoanStatus, string> = {
  active: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  closed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  cancelled: "bg-muted text-muted-foreground border-border",
};

interface Props {
  employee: { _id: string; name: string; employeeCode?: string; currency?: string };
}

export function EmployeeLoans({ employee }: Props) {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("loans", "create");
  const canEdit = hasPermission("loans", "edit");
  const canDelete = hasPermission("loans", "delete");

  const { data, isLoading } = useLoans({ employee: employee._id, limit: "50", sortBy: "createdAt", sortOrder: "desc" });
  const loans = (data?.data ?? []) as Loan[];
  const { mutate: remove, isPending: deleting } = useDeleteLoan();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<Loan | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Loan | null>(null);

  const money = (n: number) => `${employee.currency ? employee.currency + " " : ""}${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  if (isLoading) return <Card className="p-12 text-center text-sm text-muted-foreground">Loading…</Card>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{loans.length} loan{loans.length === 1 ? "" : "s"}</p>
        {canCreate && <Button size="sm" onClick={() => { setSelected(null); setDialogOpen(true); }}><Plus className="h-4 w-4" />New Loan</Button>}
      </div>

      {loans.length === 0 ? (
        <Card className="p-12 text-center">
          <Banknote className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No loans</p>
          <p className="mt-1 text-sm text-muted-foreground">Record a loan or advance — it&apos;s repaid via monthly salary deductions.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {loans.map((l) => {
            const pct = l.amount > 0 ? Math.min(100, Math.round((l.amountRepaid / l.amount) * 100)) : 0;
            return (
              <Card key={l._id} className="p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{money(l.amount)}</span>
                      <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", statusStyles[l.status])}>{LOAN_STATUS_LABELS[l.status]}</span>
                    </div>
                    {l.purpose && <p className="text-xs text-muted-foreground">{l.purpose}</p>}
                  </div>
                  <div className="flex items-center gap-1">
                    {canEdit && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setSelected(l); setDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button>}
                    {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(l)}><Trash2 className="h-4 w-4" /></Button>}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Monthly</p><p className="font-medium">{money(l.monthlyDeduction)}</p></div>
                  <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Instalments</p><p className="font-medium">{l.installments}</p></div>
                  <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Repaid</p><p className="font-medium">{money(l.amountRepaid)}</p></div>
                </div>
                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
              </Card>
            );
          })}
        </div>
      )}

      <LoanDialog open={dialogOpen} onOpenChange={setDialogOpen} loan={selected} employee={selected ? null : employee} />
      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete loan" description="This loan record will be permanently removed." isPending={deleting}
        onConfirm={() => deleteTarget && remove(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) })}
      />
    </div>
  );
}
