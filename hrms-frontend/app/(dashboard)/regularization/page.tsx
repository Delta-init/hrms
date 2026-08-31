"use client";
import { useState } from "react";
import { ClipboardCheck, Plus, Loader2, Check, X, ListChecks, Inbox, Send, Trash2, Pencil, LogIn, LogOut, AlertCircle, ShieldAlert } from "lucide-react";
import { useRegularizations, useMyRegularizations, useMyRegularizationAllowance, useReviewRegularization, useDeleteRegularization } from "@/hooks/useRegularizations";
import { useAuth } from "@/hooks/useAuth";
import { useTableQuery } from "@/hooks/useTableQuery";
import { DateRangeFilter } from "@/components/shared/DateRangeFilter";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { RegularizationDialog } from "@/components/regularization/RegularizationDialog";
import { RegularizationReviewDialog } from "@/components/regularization/RegularizationReviewDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserSelect } from "@/components/pickers";
import { getInitials, cn } from "@/lib/utils";
import { canActOnWorkflowStep, workflowStepLabel } from "@/lib/workflow";
import { REGULARIZATION_TYPE_LABELS, type Regularization, type RegularizationStatus, type RegularizationType, type RegularizationOutcome, ATTENDANCE_STATUS_LABELS } from "@/types";

const ALL = "__all__";
/**
 * Marks a request that has gone past the month's allowance.
 *
 * Shown wherever an approver sees the request, because the useful thing is
 * knowing *before* clicking Approve that it is not theirs to approve — being
 * told by a 403 afterwards is a worse way to learn the rule.
 */
function EscalatedTag({ r }: { r: Regularization }) {
  if (!r.escalated) return null;
  const who = r.escalatedTo && typeof r.escalatedTo === "object" ? r.escalatedTo.name : null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600"
      title={who ? `Past the monthly allowance — only ${who} can approve it` : "Past the monthly allowance — the reporting manager approves it"}
    >
      <ShieldAlert className="h-3 w-3" />
      #{r.monthlyIndex} · {who ?? "manager"}
    </span>
  );
}

const statusStyles: Record<RegularizationStatus, string> = {
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  rejected: "bg-red-500/10 text-red-600 border-red-500/20",
  cancelled: "bg-muted text-muted-foreground border-border",
};
const fmtDate = (iso: string, tz?: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: tz }).format(new Date(iso));
const fmtTime = (iso?: string | null, tz?: string) => (iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso)) : "—");

// Simple table for Approvals / My tabs.
function SimpleRegTable({ rows, loading, error, emptyText, canApprove, canEdit, canDelete, onReview, onEdit, onDelete, reviewerRoleId, isSuperAdmin }: {
  rows: Regularization[]; loading?: boolean; error?: unknown; emptyText: string;
  canApprove?: boolean; canEdit?: boolean; canDelete?: boolean;
  onReview?: (r: Regularization, a: "approved" | "rejected") => void;
  onEdit?: (r: Regularization) => void;
  onDelete?: (r: Regularization) => void;
  reviewerRoleId?: string; isSuperAdmin?: boolean;
}) {
  // An empty list and a failed request used to look identical here — both drew
  // the cheerful "no pending requests" line, so a 403 or a dropped connection
  // read as "nothing to approve".
  const showActions = canApprove || canEdit || canDelete;
  const cols = 5 + (showActions ? 1 : 0);
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-5 py-3 font-semibold">Employee</th><th className="px-5 py-3 font-semibold">Date</th><th className="px-5 py-3 font-semibold">Type</th><th className="px-5 py-3 font-semibold">Requested</th><th className="px-5 py-3 font-semibold">Status</th>{showActions && <th className="px-5 py-3 text-right font-semibold">Actions</th>}
          </tr></thead>
          <tbody className="divide-y divide-border">
            {loading ? <tr><td colSpan={cols} className="px-5 py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></td></tr>
            : error ? <tr><td colSpan={cols} className="px-5 py-16 text-center text-sm text-destructive"><AlertCircle className="mx-auto mb-2 h-6 w-6" />Could not load requests. Refresh to try again.</td></tr>
            : rows.length === 0 ? <tr><td colSpan={cols} className="px-5 py-16 text-center text-muted-foreground">{emptyText}</td></tr>
            : rows.map((r) => { const name = r.user && typeof r.user === "object" ? r.user.name : "—"; return (
              <tr key={r._id} className="hover:bg-muted/30">
                <td className="px-5 py-3.5"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{getInitials(name)}</div><span className="font-medium">{name}</span></div></td>
                <td className="px-5 py-3.5 text-muted-foreground">{fmtDate(r.date, r.timeZone)}</td>
                <td className="px-5 py-3.5">
                  <p>{REGULARIZATION_TYPE_LABELS[r.type]}</p>
                  <p className="text-[11px] text-muted-foreground">→ marks {ATTENDANCE_STATUS_LABELS[r.resultingStatus ?? "present"]}</p>
                </td>
                <td className="px-5 py-3.5 text-xs"><span className="inline-flex items-center gap-1 text-emerald-600"><LogIn className="h-3 w-3" />{fmtTime(r.requestedCheckIn, r.timeZone)}</span><span className="mx-1 text-muted-foreground">/</span><span className="inline-flex items-center gap-1 text-rose-500"><LogOut className="h-3 w-3" />{fmtTime(r.requestedCheckOut, r.timeZone)}</span></td>
                <td className="px-5 py-3.5">
                  <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", statusStyles[r.status])}>{r.status}</span>
                  {r.status === "pending" && <EscalatedTag r={r} />}
                  {workflowStepLabel(r) && <span className="ml-1.5 text-[11px] text-muted-foreground">{workflowStepLabel(r)}</span>}
                </td>
                {showActions && <td className="px-5 py-3.5"><div className="flex items-center justify-end gap-1">
                  {canEdit && r.status === "pending" && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit?.(r)}><Pencil className="h-4 w-4" /></Button>}
                  {canApprove && r.status === "pending" && canActOnWorkflowStep(r, reviewerRoleId, isSuperAdmin) && <><Button size="sm" variant="outline" className="h-7 gap-1 text-emerald-600" onClick={() => onReview?.(r, "approved")}><Check className="h-3.5 w-3.5" />Approve</Button><Button size="sm" variant="outline" className="h-7 gap-1 text-red-600" onClick={() => onReview?.(r, "rejected")}><X className="h-3.5 w-3.5" />Reject</Button></>}
                  {canDelete && <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => onDelete?.(r)}><Trash2 className="h-4 w-4" /></Button>}
                </div></td>}
              </tr>
            ); })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function RegularizationPage() {
  const { user, hasPermission } = useAuth();
  const canApprove = hasPermission("regularization", "approve");
  const canEdit = hasPermission("regularization", "edit");
  const canDelete = hasPermission("regularization", "delete");
  const reviewerRoleId = user?.role?._id;
  const isSuperAdmin = !!user?.role?.isSystemRole && user?.role?.roleName === "Super Admin";

  const [tab, setTab] = useState("requests");
  const query = useTableQuery({ defaultSortBy: "createdAt", defaultSortOrder: "desc" });

  // Both are gated on the permission rather than merely passing no params:
  // without the guard the hook still fired, so every load made an extra
  // unfiltered call — a guaranteed 403 for anyone who cannot view the module.
  const { data: allData, isLoading: allLoading, isFetching } = useRegularizations(query.params, canApprove);
  const { data: pendingData, isLoading: pendingLoading, error: pendingError } =
    useRegularizations({ status: "pending", limit: "200" }, canApprove);
  const { data: mineData, isLoading: mineLoading, error: mineError } = useMyRegularizations({ limit: "200" });
  const { data: allowance } = useMyRegularizationAllowance();

  const { mutate: review_, isPending: reviewing } = useReviewRegularization();
  const { mutate: remove, isPending: deleting } = useDeleteRegularization();

  const pending = pendingData?.data ?? [];
  const mine = mineData?.data ?? [];

  const [applyOpen, setApplyOpen] = useState(false);
  const [adminApplyOpen, setAdminApplyOpen] = useState(false);
  const [review, setReview] = useState<{ reg: Regularization; action: "approved" | "rejected" } | null>(null);
  const [editTarget, setEditTarget] = useState<Regularization | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Regularization | null>(null);

  const tabs = [
    canApprove && { key: "requests", label: "Requests", icon: ListChecks },
    canApprove && { key: "approvals", label: "Approvals", icon: Inbox, count: pending.length },
    { key: "mine", label: "My Requests", icon: Send },
  ].filter(Boolean) as { key: string; label: string; icon: React.ElementType; count?: number }[];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : (tabs[0]?.key ?? "mine");

  const columns: DataTableColumn<Regularization>[] = [
    { id: "employee", label: "Employee", alwaysVisible: true, render: (r) => { const name = r.user && typeof r.user === "object" ? r.user.name : "—"; return <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{getInitials(name)}</div><span className="font-medium">{name}</span></div>; } },
    { id: "date", label: "Date", sortKey: "date", render: (r) => <span className="text-muted-foreground">{fmtDate(r.date, r.timeZone)}</span> },
    {
      id: "type", label: "Type", sortKey: "type",
      render: (r) => (
        <div>
          <p>{REGULARIZATION_TYPE_LABELS[r.type]}</p>
          <p className="text-[11px] text-muted-foreground">
            → marks {ATTENDANCE_STATUS_LABELS[r.resultingStatus ?? "present"]}
          </p>
        </div>
      ),
    },
    { id: "requested", label: "Requested", render: (r) => <span className="text-xs"><span className="inline-flex items-center gap-1 text-emerald-600"><LogIn className="h-3 w-3" />{fmtTime(r.requestedCheckIn, r.timeZone)}</span><span className="mx-1 text-muted-foreground">/</span><span className="inline-flex items-center gap-1 text-rose-500"><LogOut className="h-3 w-3" />{fmtTime(r.requestedCheckOut, r.timeZone)}</span></span> },
    {
      id: "status", label: "Status", sortKey: "status",
      render: (r) => (
        <>
          <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", statusStyles[r.status])}>{r.status}</span>
          {workflowStepLabel(r) && <span className="ml-1.5 text-[11px] text-muted-foreground">{workflowStepLabel(r)}</span>}
          {r.status === "pending" && <div className="mt-0.5"><EscalatedTag r={r} /></div>}
        </>
      ),
    },
    { id: "actions", label: "", alwaysVisible: true, align: "right", render: (r) => (
      <div className="flex items-center justify-end gap-1">
        {canEdit && r.status === "pending" && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditTarget(r)}><Pencil className="h-4 w-4" /></Button>}
        {canApprove && r.status === "pending" && canActOnWorkflowStep(r, reviewerRoleId, isSuperAdmin) && <>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-emerald-600" onClick={() => setReview({ reg: r, action: "approved" })}><Check className="h-3.5 w-3.5" />Approve</Button>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-red-600" onClick={() => setReview({ reg: r, action: "rejected" })}><X className="h-3.5 w-3.5" />Reject</Button>
        </>}
        {canDelete && <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(r)}><Trash2 className="h-4 w-4" /></Button>}
      </div>
    ) },
  ];

  const filters = (
    <>
      <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Employee</Label>
        <UserSelect value={query.filters.user} onChange={(v) => query.setFilter("user", v)} placeholder="All employees" allowClear className="h-9 w-[160px]" />
      </div>
      <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Status</Label>
        <Select value={query.filters.status ?? ALL} onValueChange={(v) => query.setFilter("status", v)}><SelectTrigger className="h-9 w-[130px]"><SelectValue placeholder="All" /></SelectTrigger><SelectContent><SelectItem value={ALL}>All status</SelectItem>{(["pending", "approved", "rejected", "cancelled"] as RegularizationStatus[]).map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent></Select>
      </div>
      <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Type</Label>
        <Select value={query.filters.type ?? ALL} onValueChange={(v) => query.setFilter("type", v)}><SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="All" /></SelectTrigger><SelectContent><SelectItem value={ALL}>All types</SelectItem>{(Object.keys(REGULARIZATION_TYPE_LABELS) as RegularizationType[]).map((t) => <SelectItem key={t} value={t}>{REGULARIZATION_TYPE_LABELS[t]}</SelectItem>)}</SelectContent></Select>
      </div>
      <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">From</Label><Input type="date" value={query.filters.dateFrom ?? ""} onChange={(e) => query.setFilter("dateFrom", e.target.value)} className="h-9 w-[150px]" /></div>
      <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">To</Label><Input type="date" value={query.filters.dateTo ?? ""} onChange={(e) => query.setFilter("dateTo", e.target.value)} className="h-9 w-[150px]" /></div>
    </>
  );

  return (
    <div>
      <PageHeader
        title="Regularization"
        description="Correct missed check-ins / check-outs. Approvals update attendance automatically."
        icon={ClipboardCheck}
        action={canApprove && activeTab === "requests" && <Button onClick={() => setAdminApplyOpen(true)} className="shadow-sm"><Plus className="h-4 w-4" />New Request</Button>}
      />

      <Tabs tabs={tabs} value={activeTab} onChange={setTab} />

      {activeTab === "requests" && (
        <DataTable
          tableId="regularizations" columns={columns} rows={allData?.data ?? []} rowKey={(r) => r._id}
          loading={allLoading || isFetching} pagination={allData?.pagination} query={query}
          searchable={false} filters={filters} rowLabel="requests" emptyText="No regularization requests." minWidth={780}
            quickFilters={
              <DateRangeFilter
                from={query.filters.dateFrom}
                to={query.filters.dateTo}
                onChange={({ from, to }) => query.setFilters({ dateFrom: from, dateTo: to })}
                onClear={() => query.setFilters({ dateFrom: undefined, dateTo: undefined })}
              />
            }
          exportName="regularizations"
          exportMapper={(r) => ({
            Employee: r.user && typeof r.user === "object" ? r.user.name : "",
            Date: fmtDate(r.date, r.timeZone), Type: REGULARIZATION_TYPE_LABELS[r.type],
            "Marks as": ATTENDANCE_STATUS_LABELS[r.resultingStatus ?? "present"],
            CheckIn: fmtTime(r.requestedCheckIn, r.timeZone), CheckOut: fmtTime(r.requestedCheckOut, r.timeZone),
            Status: r.status,
          })}
        />
      )}

      {activeTab === "approvals" && (
        <SimpleRegTable
          rows={pending} loading={pendingLoading} error={pendingError} emptyText="No pending requests 🎉"
          canApprove={canApprove} canEdit={canEdit} canDelete={canDelete}
          onReview={(r, a) => setReview({ reg: r, action: a })}
          onEdit={setEditTarget} onDelete={setDeleteTarget}
          reviewerRoleId={reviewerRoleId} isSuperAdmin={isSuperAdmin}
        />
      )}

      {activeTab === "mine" && (
        <div className="space-y-4">
          <Card className="flex items-center justify-between p-5">
            <div>
              <h3 className="text-base font-semibold">Request a correction</h3>
              <p className="text-sm text-muted-foreground">Raise a regularization for a day you missed a punch.</p>
              {/* Said before they submit, not after. The allowance is not a
                  refusal, so the wording is about who sees it rather than
                  whether they may ask. */}
              {allowance && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {allowance.nextNeedsManager ? (
                    <span className="text-amber-600">
                      You have used {allowance.used} of {allowance.limit} this month — your next one goes to your reporting manager.
                    </span>
                  ) : (
                    <>{allowance.remaining} of {allowance.limit} left this month</>
                  )}
                </p>
              )}
            </div>
            <Button onClick={() => setApplyOpen(true)}><Plus className="h-4 w-4" />New Request</Button>
          </Card>
          <SimpleRegTable
            rows={mine} loading={mineLoading} error={mineError} emptyText="You have no regularization requests."
            canEdit onEdit={setEditTarget}
          />
        </div>
      )}

      <RegularizationDialog open={applyOpen} onOpenChange={setApplyOpen} lockToUserId={user?._id} />
      <RegularizationDialog open={adminApplyOpen} onOpenChange={setAdminApplyOpen} />
      <RegularizationDialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)} record={editTarget} />
      <RegularizationReviewDialog
        open={!!review}
        onOpenChange={(o) => !o && setReview(null)}
        record={review?.reg ?? null}
        action={review?.action ?? "approved"}
        isPending={reviewing}
        onConfirm={(note, resultingStatus: RegularizationOutcome) =>
          review && review_(
            {
              id: review.reg._id,
              data: {
                status: review.action,
                reviewNote: note || undefined,
                // Only sent on approval — a rejection leaves the day untouched.
                ...(review.action === "approved" ? { resultingStatus } : {}),
              },
            },
            { onSuccess: () => setReview(null) }
          )
        }
      />
      <ConfirmDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)} title="Delete request" description="This regularization request will be removed." isPending={deleting} onConfirm={() => deleteTarget && remove(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) })} />
    </div>
  );
}
