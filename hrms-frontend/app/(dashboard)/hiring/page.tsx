"use client";
import { useState } from "react";
import { Briefcase, Plus, Check, X, MoreHorizontal, Trash2, AlertTriangle, Settings, Users } from "lucide-react";
import Link from "next/link";
import { useRequisitions, useHiringWorkflow, useReviewRequisition, useDeleteRequisition } from "@/hooks/useHiring";
import { useAuth } from "@/hooks/useAuth";
import { useTableQuery } from "@/hooks/useTableQuery";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { RequisitionDialog } from "@/components/hiring/RequisitionDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  REQUISITION_STATUS_LABELS, REQUISITION_TYPE_LABELS,
  type JobRequisition, type RequisitionStatus, type RequisitionType,
} from "@/types";

const ALL = "__all__";

const statusStyles: Record<RequisitionStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  rejected: "bg-red-500/10 text-red-600 border-red-500/20",
  on_hold: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  filled: "bg-primary/10 text-primary border-primary/20",
  cancelled: "bg-muted text-muted-foreground border-border",
};

const fmtDate = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—";
const nameOf = (v: unknown) => (v && typeof v === "object" ? (v as { name?: string }).name ?? "—" : "—");

export default function HiringPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("hiring", "create");
  const canApprove = hasPermission("hiring", "approve");
  const canDelete = hasPermission("hiring", "delete");

  const query = useTableQuery({ defaultSortBy: "createdAt", defaultSortOrder: "desc" });
  const { data, isLoading, isFetching } = useRequisitions(query.params);
  const { data: workflow } = useHiringWorkflow();
  const { mutate: review, isPending: reviewing } = useReviewRequisition();
  const { mutate: remove, isPending: deleting } = useDeleteRequisition();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<JobRequisition | null>(null);

  const columns: DataTableColumn<JobRequisition>[] = [
    {
      id: "role", label: "Role", alwaysVisible: true,
      render: (r) => (
        <Link href={`/hiring/${r._id}`} className="block min-w-0 hover:underline">
          <div className="truncate font-medium">{r.title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {nameOf(r.department)}{r.headcount > 1 ? ` · ${r.headcount} positions` : ""}
          </div>
        </Link>
      ),
    },
    {
      id: "type", label: "Type", alwaysVisible: true,
      render: (r) => (
        <div className="min-w-0">
          <div>{REQUISITION_TYPE_LABELS[r.type]}</div>
          {r.type === "replacement" && (
            <div className="truncate text-xs text-muted-foreground">for {nameOf(r.replacing)}</div>
          )}
        </div>
      ),
    },
    {
      id: "budget", label: "Budget",
      render: (r) => (
        <div className="tabular-nums">
          {r.salaryMax ? `${r.currency ?? ""} ${r.salaryMin ? `${r.salaryMin}–` : "up to "}${r.salaryMax}`.trim() : "—"}
          {/* Why Finance is in the chain at all, on the row that answers for it. */}
          {r.budgetApprovalRequired && (
            <div className="text-[10px] uppercase tracking-wide text-amber-600">needs accounts</div>
          )}
        </div>
      ),
    },
    { id: "raisedBy", label: "Raised by", defaultVisible: false, render: (r) => <span className="text-muted-foreground">{nameOf(r.raisedBy)}</span> },
    { id: "wanted", label: "Wanted by", render: (r) => <span className="text-muted-foreground">{fmtDate(r.targetStartDate)}</span> },
    {
      id: "stage", label: "Stage",
      render: (r) =>
        r.status === "pending" && r.workflowTotalSteps ? (
          <span className="text-xs text-muted-foreground">
            {r.approvalSteps?.find((s) => s.order === r.workflowStep)?.roleName ?? "—"}
            <span className="ml-1 opacity-60">({r.workflowStep}/{r.workflowTotalSteps})</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: "status", label: "Status", alwaysVisible: true, sortKey: "status",
      render: (r) => (
        <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[r.status])}>
          {REQUISITION_STATUS_LABELS[r.status]}
        </span>
      ),
    },
    {
      id: "actions", label: "", alwaysVisible: true, align: "right",
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          {canApprove && r.status === "pending" && (
            <>
              <Button size="sm" variant="outline" disabled={reviewing}
                onClick={() => review({ id: r._id, status: "approved" })}>
                <Check className="h-3.5 w-3.5" />Approve
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive" disabled={reviewing}
                onClick={() => review({ id: r._id, status: "rejected" })}>
                <X className="h-3.5 w-3.5" />Reject
              </Button>
            </>
          )}
          {canDelete && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setDeleteTarget(r)} className="cursor-pointer text-destructive focus:text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hiring"
        description="Requests to fill a role, and the approvals they clear before recruiting starts."
        icon={Briefcase}
        action={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline"><Link href="/hiring/candidates"><Users className="h-4 w-4" />Candidates</Link></Button>
            {canCreate && <Button onClick={() => setDialogOpen(true)} className="shadow-sm"><Plus className="h-4 w-4" />Raise requisition</Button>}
          </div>
        }
      />

      {/* Without a configured chain every approvable module falls back to
          single-step, so the Accounts gate would silently not exist. Say so
          rather than letting somebody believe a control is in force. */}
      {workflow && !workflow.configured && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            No hiring approval chain is configured, so any one approver can decide a requisition on their own —
            the Accounts step is not in force. Set it up under{" "}
            <Link href="/approval-workflows" className="font-medium underline">Approval Workflows</Link>:
            step 1 <strong>Accounts</strong> (only when the budget increases), step 2 <strong>HR</strong>.
          </span>
        </div>
      )}

      {workflow?.configured && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
          <Settings className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">Approval chain</span>
          {workflow.steps.map((s, i) => (
            <span key={s.order} className="flex items-center gap-2">
              {i > 0 && <span className="opacity-40">→</span>}
              <span className="rounded-full border border-border px-2 py-0.5">
                {s.label || s.roleName}
                {s.when === "budget_increase" && <span className="ml-1 text-amber-600">(budget increases only)</span>}
              </span>
            </span>
          ))}
        </div>
      )}

      <DataTable
        tableId="hiring_requisitions"
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(r) => r._id}
        loading={isLoading || isFetching}
        pagination={data?.pagination}
        query={query}
        searchable
        searchPlaceholder="Search by role title…"
        emptyText="No requisitions yet."
        rowLabel="requisitions"
        minWidth={980}
        filters={
          <>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={query.filters.status ?? ALL} onValueChange={(v) => query.setFilter("status", v)}>
                <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  {(Object.keys(REQUISITION_STATUS_LABELS) as RequisitionStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{REQUISITION_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={query.filters.type ?? ALL} onValueChange={(v) => query.setFilter("type", v)}>
                <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="All" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All types</SelectItem>
                  {(Object.keys(REQUISITION_TYPE_LABELS) as RequisitionType[]).map((t) => (
                    <SelectItem key={t} value={t}>{REQUISITION_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        }
        exportMapper={(r) => ({
          Role: r.title,
          Type: REQUISITION_TYPE_LABELS[r.type],
          Replacing: r.type === "replacement" ? nameOf(r.replacing) : "",
          Department: nameOf(r.department),
          Headcount: r.headcount,
          "Budget up to": r.salaryMax ?? "",
          Currency: r.currency ?? "",
          "Needs accounts": r.budgetApprovalRequired ? "Yes" : "No",
          "Raised by": nameOf(r.raisedBy),
          "Wanted by": fmtDate(r.targetStartDate),
          Status: REQUISITION_STATUS_LABELS[r.status],
        })}
        exportName="hiring-requisitions"
      />

      <RequisitionDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete this requisition?"
        description={`"${deleteTarget?.title}" and its approval trail will be removed. This cannot be undone.`}
        confirmLabel="Delete"
        isPending={deleting}
        onConfirm={() => { if (deleteTarget) remove(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) }); }}
      />
    </div>
  );
}
