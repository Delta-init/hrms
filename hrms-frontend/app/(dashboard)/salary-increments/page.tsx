"use client";
import { useState } from "react";
import { TrendingUp, Plus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useSalaryIncrements, useDeleteSalaryIncrement } from "@/hooks/useSalaryIncrements";
import { useAuth } from "@/hooks/useAuth";
import { useTableQuery } from "@/hooks/useTableQuery";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { SalaryIncrementDialog } from "@/components/salary/SalaryIncrementDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials, cn } from "@/lib/utils";
import type { SalaryIncrement } from "@/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMonth = (m: string) => { const [y, mm] = m.split("-"); return `${MONTHS[Number(mm) - 1]} ${y}`; };
const empOf = (i: SalaryIncrement) => (i.employee && typeof i.employee === "object" ? i.employee : null);
const money = (n: number, c?: string) => `${c ? c + " " : ""}${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function SalaryIncrementsPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("salaryIncrements", "create");
  const canEdit = hasPermission("salaryIncrements", "edit");
  const canDelete = hasPermission("salaryIncrements", "delete");

  const query = useTableQuery({ defaultSortBy: "effectiveMonth", defaultSortOrder: "desc" });
  const { data, isLoading, isFetching } = useSalaryIncrements(query.params);
  const { mutate: remove, isPending: deleting } = useDeleteSalaryIncrement();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<SalaryIncrement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SalaryIncrement | null>(null);

  const columns: DataTableColumn<SalaryIncrement>[] = [
    {
      id: "employee", label: "Employee", alwaysVisible: true,
      render: (i) => {
        const e = empOf(i);
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{getInitials(e?.name ?? "?")}</div>
            <div className="min-w-0"><p className="truncate font-medium">{e?.name ?? "—"}</p><p className="truncate text-xs text-muted-foreground">{e?.employeeCode ?? ""}</p></div>
          </div>
        );
      },
    },
    { id: "previous", label: "Previous", align: "right", render: (i) => <span className="tabular-nums text-muted-foreground">{money(i.previousSalary, empOf(i)?.currency)}</span> },
    { id: "new", label: "New salary", align: "right", sortKey: "newSalary", render: (i) => <span className="font-medium tabular-nums">{money(i.newSalary, empOf(i)?.currency)}</span> },
    {
      id: "change", label: "Change", align: "right", render: (i) => {
        const diff = i.newSalary - i.previousSalary;
        const pct = i.previousSalary > 0 ? (diff / i.previousSalary) * 100 : 0;
        return <span className={cn("font-semibold tabular-nums", diff >= 0 ? "text-emerald-600" : "text-red-500")}>{diff >= 0 ? "+" : ""}{money(diff, empOf(i)?.currency)}{i.previousSalary > 0 ? ` (${diff >= 0 ? "+" : ""}${pct.toFixed(1)}%)` : ""}</span>;
      },
    },
    { id: "effective", label: "Effective", sortKey: "effectiveMonth", render: (i) => <span className="font-medium">{fmtMonth(i.effectiveMonth)}</span> },
    { id: "reason", label: "Reason", defaultVisible: false, render: (i) => <span className="text-muted-foreground">{i.reason || "—"}</span> },
    {
      id: "actions", label: "", alwaysVisible: true, align: "right",
      render: (i) => (
        (canEdit || canDelete) ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit && <DropdownMenuItem onClick={() => { setSelected(i); setDialogOpen(true); }} className="cursor-pointer"><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>}
              {canDelete && <DropdownMenuItem onClick={() => setDeleteTarget(i)} className="cursor-pointer text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Salary Increments"
        description="Record raises with an effective month; payroll applies them automatically."
        icon={TrendingUp}
        action={canCreate && <Button onClick={() => { setSelected(null); setDialogOpen(true); }} className="shadow-sm"><Plus className="h-4 w-4" />New Increment</Button>}
      />

      <DataTable
        tableId="salary-increments"
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(i) => i._id}
        loading={isLoading || isFetching}
        pagination={data?.pagination}
        query={query}
        searchable={false}
        rowLabel="increments"
        emptyText="No salary increments recorded."
      />

      <SalaryIncrementDialog open={dialogOpen} onOpenChange={setDialogOpen} increment={selected} />
      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete increment" description="This salary increment will be permanently removed and payroll will revert to the prior salary." isPending={deleting}
        onConfirm={() => deleteTarget && remove(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) })}
      />
    </div>
  );
}
