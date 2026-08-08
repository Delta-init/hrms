"use client";
import { useState } from "react";
import { LogOut, Plus, MoreHorizontal, Check, X, UserMinus, Undo2, Trash2, Clock, ListChecks, CheckCircle2 } from "lucide-react";
import { useResignations, useReviewResignation, useWithdrawResignation, useRelieveResignation, useDeleteResignation } from "@/hooks/useResignations";
import { useAuth } from "@/hooks/useAuth";
import { useTableQuery } from "@/hooks/useTableQuery";
import { DateRangeFilter } from "@/components/shared/DateRangeFilter";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { ResignationDialog } from "@/components/resignations/ResignationDialog";
import { ReviewDialog } from "@/components/shared/ReviewDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials, cn } from "@/lib/utils";
import { RESIGNATION_STATUS_LABELS, type Resignation, type ResignationStatus } from "@/types";

const statusStyles: Record<ResignationStatus, string> = {
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  accepted: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  rejected: "bg-red-500/10 text-red-600 border-red-500/20",
  withdrawn: "bg-muted text-muted-foreground border-border",
  relieved: "bg-violet-500/10 text-violet-600 border-violet-500/20",
};
const fmtDate = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—");
const empOf = (r: Resignation) => (r.employee && typeof r.employee === "object" ? r.employee : null);
const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);

const TABS = [
  { key: "pending", label: "Pending", icon: Clock, status: "pending" },
  { key: "notice", label: "Serving notice", icon: ListChecks, status: "accepted" },
  { key: "completed", label: "Completed", icon: CheckCircle2, status: "rejected,withdrawn,relieved" },
] as const;

export default function ResignationsPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("resignations", "view");
  const canCreate = hasPermission("resignations", "create");
  const canApprove = hasPermission("resignations", "approve");
  const canEdit = hasPermission("resignations", "edit");
  const canDelete = hasPermission("resignations", "delete");

  const [tab, setTab] = useState<string>("pending");
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];
  const query = useTableQuery({ defaultSortBy: "lastWorkingDay", defaultSortOrder: "asc", defaultLimit: 20 });
  const params = { ...query.params, status: active.status };
  const { data, isLoading, isFetching } = useResignations(params, { enabled: canView });

  const { mutate: review, isPending: reviewing } = useReviewResignation();
  const { mutate: withdraw, isPending: withdrawing } = useWithdrawResignation();
  const { mutate: relieve, isPending: relieving } = useRelieveResignation();
  const { mutate: remove, isPending: deleting } = useDeleteResignation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<{ r: Resignation; action: "approved" | "rejected" } | null>(null);
  const [relieveTarget, setRelieveTarget] = useState<Resignation | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<Resignation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Resignation | null>(null);

  if (!canView) {
    return (
      <div>
        <PageHeader title="Resignations" description="Record resignations and track employees serving their notice period." icon={LogOut} />
        <Card className="p-16 text-center text-muted-foreground">You don&apos;t have access to resignations.</Card>
      </div>
    );
  }

  const employeeCol: DataTableColumn<Resignation> = {
    id: "employee", label: "Employee", alwaysVisible: true,
    render: (r) => {
      const e = empOf(r);
      return (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{getInitials(e?.name ?? "—")}</div>
          <div className="min-w-0"><p className="truncate font-medium">{e?.name ?? "—"}</p><p className="truncate text-xs text-muted-foreground">{e?.employeeCode ?? ""}</p></div>
        </div>
      );
    },
  };

  const columns: DataTableColumn<Resignation>[] = [
    employeeCol,
    { id: "resignationDate", label: "Resigned on", sortKey: "resignationDate", render: (r) => <span className="text-muted-foreground">{fmtDate(r.resignationDate)}</span> },
    { id: "notice", label: "Notice", render: (r) => <span>{r.noticePeriodDays}d</span> },
    { id: "lastWorkingDay", label: "Last working day", sortKey: "lastWorkingDay", render: (r) => <span className="font-medium">{fmtDate(r.lastWorkingDay)}</span> },
    ...(active.key === "notice" ? [{
      id: "left", label: "Days left", render: (r: Resignation) => {
        const d = daysLeft(r.lastWorkingDay);
        const total = r.noticePeriodDays || 1;
        const pct = Math.max(0, Math.min(100, (d / total) * 100));
        return (
          <div className="min-w-[90px]">
            <p className={cn("text-sm font-semibold", d <= 7 ? "text-red-600" : "text-foreground")}>{d > 0 ? `${d} days` : "Due"}</p>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", d <= 7 ? "bg-red-500" : "bg-sky-500")} style={{ width: `${pct}%` }} /></div>
          </div>
        );
      },
    } as DataTableColumn<Resignation>] : []),
    { id: "status", label: "Status", render: (r) => <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[r.status])}>{RESIGNATION_STATUS_LABELS[r.status]}</span> },
    {
      id: "actions", label: "", alwaysVisible: true, align: "right",
      render: (r) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {r.status === "pending" && canApprove && <DropdownMenuItem onClick={() => setReviewTarget({ r, action: "approved" })} className="cursor-pointer text-emerald-600 focus:text-emerald-600"><Check className="mr-2 h-4 w-4" />Accept</DropdownMenuItem>}
            {r.status === "pending" && canApprove && <DropdownMenuItem onClick={() => setReviewTarget({ r, action: "rejected" })} className="cursor-pointer text-red-600 focus:text-red-600"><X className="mr-2 h-4 w-4" />Reject</DropdownMenuItem>}
            {r.status === "accepted" && canApprove && <DropdownMenuItem onClick={() => setRelieveTarget(r)} className="cursor-pointer"><UserMinus className="mr-2 h-4 w-4" />Relieve now</DropdownMenuItem>}
            {(r.status === "pending" || r.status === "accepted") && canEdit && <DropdownMenuItem onClick={() => setWithdrawTarget(r)} className="cursor-pointer"><Undo2 className="mr-2 h-4 w-4" />Withdraw</DropdownMenuItem>}
            {canDelete && <DropdownMenuItem onClick={() => setDeleteTarget(r)} className="cursor-pointer text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const tabs = TABS.map((t) => ({ key: t.key, label: t.label, icon: t.icon }));

  return (
    <div>
      <PageHeader
        title="Resignations"
        description="Record resignations and track employees serving their notice period."
        icon={LogOut}
        action={canCreate && <Button onClick={() => setDialogOpen(true)} className="shadow-sm"><Plus className="h-4 w-4" />Record Resignation</Button>}
      />

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      <DataTable
        key={active.key}
        tableId={`resignations-${active.key}`} columns={columns} rows={data?.data ?? []} rowKey={(r) => r._id}
        loading={isLoading || isFetching} pagination={data?.pagination} query={query}
        searchable={false} rowLabel="resignations" minWidth={820}
        quickFilters={
          <DateRangeFilter
            from={query.filters.dateFrom}
            to={query.filters.dateTo}
            onChange={({ from, to }) => query.setFilters({ dateFrom: from, dateTo: to })}
            onClear={() => query.setFilters({ dateFrom: undefined, dateTo: undefined })}
            label="Last working day"
          />
        }
        emptyText={active.key === "pending" ? "No pending resignations." : active.key === "notice" ? "Nobody is serving notice." : "Nothing here yet."}
        exportName="resignations"
        exportMapper={(r) => ({ Employee: empOf(r)?.name ?? "", Code: empOf(r)?.employeeCode ?? "", "Resigned on": fmtDate(r.resignationDate), Notice: r.noticePeriodDays, "Last working day": fmtDate(r.lastWorkingDay), Status: RESIGNATION_STATUS_LABELS[r.status] })}
      />

      <ResignationDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <ReviewDialog
        open={!!reviewTarget} onOpenChange={(o) => !o && setReviewTarget(null)}
        action={reviewTarget?.action ?? "approved"}
        subject={reviewTarget ? `${empOf(reviewTarget.r)?.name} · last working day ${fmtDate(reviewTarget.r.lastWorkingDay)}` : undefined}
        isPending={reviewing}
        onConfirm={(note) => reviewTarget && review({ id: reviewTarget.r._id, data: { status: reviewTarget.action === "approved" ? "accepted" : "rejected", reviewNote: note || undefined } }, { onSuccess: () => setReviewTarget(null) })}
      />
      <ConfirmDialog
        open={!!relieveTarget} onOpenChange={(o) => !o && setRelieveTarget(null)}
        title="Relieve employee" description={`${(relieveTarget && empOf(relieveTarget)?.name) || "This employee"} will be marked relieved and their status set to Terminated.`}
        confirmLabel="Relieve" isPending={relieving}
        onConfirm={() => relieveTarget && relieve(relieveTarget._id, { onSuccess: () => setRelieveTarget(null) })}
      />
      <ConfirmDialog
        open={!!withdrawTarget} onOpenChange={(o) => !o && setWithdrawTarget(null)}
        title="Withdraw resignation" description="The resignation is cancelled. If they were serving notice, they return to Active."
        confirmLabel="Withdraw" isPending={withdrawing}
        onConfirm={() => withdrawTarget && withdraw(withdrawTarget._id, { onSuccess: () => setWithdrawTarget(null) })}
      />
      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete resignation" description="This record will be permanently removed." isPending={deleting}
        onConfirm={() => deleteTarget && remove(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) })}
      />
    </div>
  );
}
