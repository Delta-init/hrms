"use client";
import { useState } from "react";
import { Banknote, Plus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useLoans, useDeleteLoan } from "@/hooks/useLoans";
import { useAuth } from "@/hooks/useAuth";
import { useTableQuery } from "@/hooks/useTableQuery";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { LoanDialog } from "@/components/loans/LoanDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials, cn } from "@/lib/utils";
import { LOAN_STATUS_LABELS, type Loan, type LoanStatus } from "@/types";

const ALL = "__all__";
const statusStyles: Record<LoanStatus, string> = {
  active: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  closed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  cancelled: "bg-muted text-muted-foreground border-border",
};
const empOf = (l: Loan) => (l.employee && typeof l.employee === "object" ? l.employee : null);
const money = (n: number, cur?: string) => `${cur ? cur + " " : ""}${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default function LoansPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("loans", "view");
  const canCreate = hasPermission("loans", "create");
  const canEdit = hasPermission("loans", "edit");
  const canDelete = hasPermission("loans", "delete");

  const query = useTableQuery({ defaultSortBy: "createdAt", defaultSortOrder: "desc" });
  const { data, isLoading, isFetching } = useLoans(query.params, { enabled: canView });
  const { mutate: remove, isPending: deleting } = useDeleteLoan();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<Loan | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Loan | null>(null);

  if (!canView) {
    return (
      <div>
        <PageHeader title="Loans" description="Employee loans & advances, repaid via monthly salary deductions." icon={Banknote} />
        <Card className="p-16 text-center text-muted-foreground">You don&apos;t have access to loans.</Card>
      </div>
    );
  }

  const columns: DataTableColumn<Loan>[] = [
    {
      id: "employee", label: "Employee", alwaysVisible: true,
      render: (l) => {
        const e = empOf(l);
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{getInitials(e?.name ?? "?")}</div>
            <div className="min-w-0"><p className="truncate font-medium">{e?.name ?? "—"}</p><p className="truncate text-xs text-muted-foreground">{e?.employeeCode ?? ""}</p></div>
          </div>
        );
      },
    },
    { id: "amount", label: "Amount", sortKey: "amount", render: (l) => <span className="font-medium">{money(l.amount, empOf(l)?.currency)}</span> },
    { id: "purpose", label: "Purpose", render: (l) => <span className="text-muted-foreground">{l.purpose || "—"}</span> },
    { id: "monthly", label: "Monthly", render: (l) => <span className="text-muted-foreground">{money(l.monthlyDeduction, empOf(l)?.currency)}</span> },
    {
      id: "repaid", label: "Repaid", render: (l) => {
        const pct = l.amount > 0 ? Math.min(100, Math.round((l.amountRepaid / l.amount) * 100)) : 0;
        return (
          <div className="min-w-[120px]">
            <div className="mb-1 flex justify-between text-[11px] text-muted-foreground"><span>{money(l.amountRepaid, empOf(l)?.currency)}</span><span>{pct}%</span></div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
          </div>
        );
      },
    },
    {
      id: "status", label: "Status", sortKey: "status",
      render: (l) => <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[l.status])}>{LOAN_STATUS_LABELS[l.status]}</span>,
    },
    {
      id: "actions", label: "", alwaysVisible: true, align: "right",
      render: (l) => (
        (canEdit || canDelete) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit && <DropdownMenuItem onClick={() => { setSelected(l); setDialogOpen(true); }} className="cursor-pointer"><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>}
              {canDelete && <DropdownMenuItem onClick={() => setDeleteTarget(l)} className="cursor-pointer text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null
      ),
    },
  ];

  const filters = (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">Status</Label>
      <Select value={query.filters.status ?? ALL} onValueChange={(v) => query.setFilter("status", v)}>
        <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="All status" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All status</SelectItem>
          {(Object.keys(LOAN_STATUS_LABELS) as LoanStatus[]).map((s) => <SelectItem key={s} value={s}>{LOAN_STATUS_LABELS[s]}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Loans"
        description="Employee loans & advances, repaid via monthly salary deductions."
        icon={Banknote}
        action={canCreate && <Button onClick={() => { setSelected(null); setDialogOpen(true); }} className="shadow-sm"><Plus className="h-4 w-4" />New Loan</Button>}
      />

      <DataTable
        tableId="loans"
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(l) => l._id}
        loading={isLoading || isFetching}
        pagination={data?.pagination}
        query={query}
        searchable={false}
        filters={filters}
        rowLabel="loans"
        emptyText="No loans recorded."
      />

      <LoanDialog open={dialogOpen} onOpenChange={setDialogOpen} loan={selected} />
      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete loan" description="This loan record will be permanently removed." isPending={deleting}
        onConfirm={() => deleteTarget && remove(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) })}
      />
    </div>
  );
}
