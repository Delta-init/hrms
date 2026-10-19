"use client";
import { useState } from "react";
import { Briefcase, Plus, Check, X, MoreHorizontal, Trash2, AlertTriangle, Settings, Users, ShieldAlert, Pencil, Undo2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRequisitions, useHiringWorkflow, useReviewRequisition, useDeleteRequisition, useWithdrawRequisition } from "@/hooks/useHiring";
import { usePendingOffers, useDecideOffer } from "@/hooks/useCandidates";
import { useAuth } from "@/hooks/useAuth";
import { useTableQuery } from "@/hooks/useTableQuery";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { RequisitionDialog } from "@/components/hiring/RequisitionDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Textarea } from "@/components/ui/textarea";
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
  finance_pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  rejected: "bg-red-500/10 text-red-600 border-red-500/20",
  on_hold: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  filled: "bg-primary/10 text-primary border-primary/20",
  cancelled: "bg-muted text-muted-foreground border-border",
};

const fmtDate = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—";
const nameOf = (v: unknown) => (v && typeof v === "object" ? (v as { name?: string }).name ?? "—" : "—");
const idOf = (v: unknown) => (v && typeof v === "object" ? String((v as { _id?: string })._id ?? "") : String(v ?? ""));
/** Editable while nobody has decided anything; withdrawable until it is fully decided. */
const EDITABLE = ["draft", "pending"];
const WITHDRAWABLE = ["draft", "pending", "finance_pending", "on_hold"];

export default function HiringPage() {
  const { hasPermission, user } = useAuth();
  // A department head without the hiring permission: their own departments'
  // requisitions, raising new ones for them, and nothing company-wide — the
  // server scopes the list and refuses the rest.
  const headOnly = !hasPermission("hiring", "view") && !!user?.isDepartmentHead;
  const canCreate = hasPermission("hiring", "create") || headOnly;
  const canApprove = hasPermission("hiring", "approve");
  const canDelete = hasPermission("hiring", "delete");
  const canEditAny = hasPermission("hiring", "edit");

  const query = useTableQuery({ defaultSortBy: "createdAt", defaultSortOrder: "desc" });
  const { data, isLoading, isFetching } = useRequisitions(query.params);
  // Passed on by HR, now waiting on finance — not anybody's to act on here, so
  // a note rather than a badge, and one click shows which.
  const { data: withFinance } = useRequisitions({ status: "finance_pending", limit: "1" });
  const financeWaiting = withFinance?.pagination?.total ?? 0;
  const { data: workflow } = useHiringWorkflow(!headOnly);
  const { mutate: review, isPending: reviewing } = useReviewRequisition();
  const { mutate: remove, isPending: deleting } = useDeleteRequisition();
  const { data: pendingOffers = [] } = usePendingOffers(!headOnly);
  const { mutate: decideOffer, isPending: deciding } = useDecideOffer();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<JobRequisition | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<JobRequisition | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const { mutate: withdraw, isPending: withdrawing } = useWithdrawRequisition();
  const mine = (r: JobRequisition) => idOf(r.raisedBy) === String(user?._id ?? "");
  const canEditRow = (r: JobRequisition) => (mine(r) || canEditAny) && EDITABLE.includes(r.status) && !(r.approvalTrail ?? []).length;
  const canWithdrawRow = (r: JobRequisition) => (mine(r) || canEditAny) && WITHDRAWABLE.includes(r.status);
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
        ) : r.status === "finance_pending" ? (
          <span className="text-xs text-muted-foreground">Finance</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: "status", label: "Status", alwaysVisible: true, sortKey: "status",
      render: (r) => (
        <div>
          <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[r.status])}>
            {r.withdrawnAt ? "Withdrawn" : REQUISITION_STATUS_LABELS[r.status]}
          </span>
          {r.withdrawnAt && r.withdrawReason && (
            <div className="mt-0.5 max-w-[16rem] truncate text-[10px] text-muted-foreground" title={r.withdrawReason}>{r.withdrawReason}</div>
          )}
          {/* Who made the last call, when it was finance rather than HR. */}
          {r.financeReviewedAt && (
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">by finance</div>
          )}
        </div>
      ),
    },
    {
      id: "actions", label: "", alwaysVisible: true, align: "right",
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          {canEditRow(r) && (
            <Button size="sm" variant="ghost" onClick={() => setEditTarget(r)} aria-label="Edit requisition">
              <Pencil className="h-3.5 w-3.5" />Edit
            </Button>
          )}
          {canWithdrawRow(r) && (
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => { setWithdrawTarget(r); setWithdrawReason(""); }} aria-label="Withdraw requisition">
              <Undo2 className="h-3.5 w-3.5" />Withdraw
            </Button>
          )}
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
        description={
          headOnly
            ? "Your department's requests to fill a role, and where each one is in its approvals."
            : "Requests to fill a role, and the approvals they clear before recruiting starts."
        }
        icon={Briefcase}
        action={
          <div className="flex items-center gap-2">
            {!headOnly && <Button asChild variant="outline"><Link href="/hiring/candidates"><Users className="h-4 w-4" />Candidates</Link></Button>}
            {canCreate && <Button onClick={() => setDialogOpen(true)} className="shadow-sm"><Plus className="h-4 w-4" />Raise requisition</Button>}
          </div>
        }
      />

      {/* Without a configured chain every approvable module falls back to
          single-step, so the Accounts gate would silently not exist. Say so
          rather than letting somebody believe a control is in force. */}
      {financeWaiting > 0 && query.filters.status !== "finance_pending" && (
        <button
          type="button"
          onClick={() => query.setFilter("status", "finance_pending")}
          className="flex w-full items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-left text-sm text-amber-700 transition hover:bg-amber-500/10 dark:text-amber-400"
        >
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span><strong>{financeWaiting}</strong> requisition{financeWaiting === 1 ? " is" : "s are"} with finance, waiting on the budget decision.</span>
          <span className="ml-auto text-xs font-medium underline">Show</span>
        </button>
      )}

      {workflow && !workflow.configured && !workflow.financeStep && (
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

      {(workflow?.configured || workflow?.financeStep) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
          <Settings className="h-3.5 w-3.5" />
          <span className="font-medium text-foreground">Approval chain</span>
          {workflow.configured ? workflow.steps.map((s, i) => (
            <span key={s.order} className="flex items-center gap-2">
              {i > 0 && <span className="opacity-40">→</span>}
              <span className="rounded-full border border-border px-2 py-0.5">
                {s.label || s.roleName}
                {s.when === "budget_increase" && <span className="ml-1 text-amber-600">(budget increases only)</span>}
              </span>
            </span>
          )) : (
            <span className="rounded-full border border-border px-2 py-0.5">Approver</span>
          )}
          {/* Decided in the finance system, after everything above. */}
          {workflow.financeStep && (
            <span className="flex items-center gap-2">
              <span className="opacity-40">→</span>
              <span className="rounded-full border border-border px-2 py-0.5">
                Finance<span className="ml-1 text-amber-600">(needs accounts only)</span>
              </span>
            </span>
          )}
        </div>
      )}

      {/* An approval nobody can find is an approval that does not happen — the
          candidate simply waits. So it sits above the list, not inside a card. */}
      {pendingOffers.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-400">
            <ShieldAlert className="h-4 w-4" />
            {pendingOffers.length} offer{pendingOffers.length === 1 ? "" : "s"} waiting on management
          </p>
          <div className="space-y-2">
            {pendingOffers.map((o) => {
              const cand = o.candidate && typeof o.candidate === "object" ? o.candidate : null;
              const req = o.requisition && typeof o.requisition === "object" ? o.requisition : null;
              return (
                <div key={o._id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{cand?.name ?? "—"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {req?.title ?? "—"}
                      {o.offeredSalary ? ` · offering ${cand?.currency ?? ""} ${o.offeredSalary}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="outline" disabled={deciding}
                      onClick={() => decideOffer({ id: o._id, approve: true })}>
                      <Check className="h-3.5 w-3.5" />Release offer
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" disabled={deciding}
                      onClick={() => decideOffer({ id: o._id, approve: false })}>
                      <X className="h-3.5 w-3.5" />Refuse
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
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
          Finance: r.financeReviewedAt
            ? `${r.rejectedBy === "finance" ? "Refused" : "Approved"}${r.financeReviewedBy ? ` by ${r.financeReviewedBy}` : ""} on ${fmtDate(r.financeReviewedAt)}${r.financeNote ? ` — ${r.financeNote}` : ""}`
            : "",
        })}
        exportName="hiring-requisitions"
      />

      <RequisitionDialog open={dialogOpen} onOpenChange={setDialogOpen} headMode={headOnly} />
      <RequisitionDialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)} headMode={headOnly} requisition={editTarget} />

      <ResponsiveDialog open={!!withdrawTarget} onOpenChange={(o) => !o && setWithdrawTarget(null)}>
        <ResponsiveDialogContent desktopClassName="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Withdraw this requisition?</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-3 px-4 sm:px-0">
            <p className="text-sm text-muted-foreground">
              &ldquo;{withdrawTarget?.title}&rdquo; leaves every approval queue, finance&rsquo;s included, and stays on record as withdrawn.
              {withdrawTarget?.type === "replacement" ? " The person it would replace is not told." : ""}
            </p>
            <Textarea rows={3} maxLength={500} value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} placeholder="Why? (optional) — e.g. no longer needed, filled internally" />
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setWithdrawTarget(null)}>Keep it</Button>
            <Button variant="destructive" disabled={withdrawing}
              onClick={() => withdrawTarget && withdraw({ id: withdrawTarget._id, reason: withdrawReason.trim() }, { onSuccess: () => setWithdrawTarget(null) })}>
              {withdrawing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}Withdraw
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
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
