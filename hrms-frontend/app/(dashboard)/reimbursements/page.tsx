"use client";
import { useState } from "react";
import { Receipt, Plus, Check, X, Pencil, Trash2, Loader2, Send, ListChecks, ClipboardList } from "lucide-react";
import { useReimbursements, useMyReimbursements, useReviewReimbursement, useDeleteReimbursement } from "@/hooks/useReimbursements";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReimbursementDialog } from "@/components/reimbursements/ReimbursementDialog";
import { ReviewDialog } from "@/components/shared/ReviewDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { getInitials, cn } from "@/lib/utils";
import { canActOnWorkflowStep, workflowStepLabel } from "@/lib/workflow";
import { REIMBURSEMENT_CATEGORY_LABELS, REIMBURSEMENT_STATUS_LABELS, type Reimbursement, type ReimbursementStatus } from "@/types";

const ALL = "__all__";
const statusStyles: Record<ReimbursementStatus, string> = {
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  rejected: "bg-red-500/10 text-red-600 border-red-500/20",
  paid: "bg-sky-500/10 text-sky-600 border-sky-500/20",
};
const empOf = (r: Reimbursement) => (r.employee && typeof r.employee === "object" ? r.employee : null);
const fmtDate = (s?: string) => (s ? new Date(s).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—");
const money = (n: number, c?: string) => `${c ? c + " " : ""}${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function StatusBadge({ status }: { status: ReimbursementStatus }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[status])}>{REIMBURSEMENT_STATUS_LABELS[status]}</span>;
}

export default function ReimbursementsPage() {
  const { user, hasPermission } = useAuth();
  const canView = hasPermission("reimbursements", "view");
  const canCreate = hasPermission("reimbursements", "create");
  const canApprove = hasPermission("reimbursements", "approve");
  const canEdit = hasPermission("reimbursements", "edit");
  const canDelete = hasPermission("reimbursements", "delete");
  const reviewerRoleId = user?.role?._id;
  const isSuperAdmin = !!user?.role?.isSystemRole && user?.role?.roleName === "Super Admin";

  const [tab, setTab] = useState("mine");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [monthFilter, setMonthFilter] = useState("");

  const allParams: Record<string, string> = { limit: "200" };
  if (statusFilter !== ALL) allParams.status = statusFilter;
  if (monthFilter) allParams.month = monthFilter;

  const { data: mineData, isLoading: mineLoading } = useMyReimbursements({ limit: "200" });
  const { data: allData, isLoading: allLoading } = useReimbursements(canView ? allParams : undefined);
  const { data: pendingData, isLoading: pendingLoading } = useReimbursements(canApprove ? { status: "pending", limit: "200" } : undefined);

  const { mutate: review, isPending: reviewing } = useReviewReimbursement();
  const { mutate: remove, isPending: deleting } = useDeleteReimbursement();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<Reimbursement | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{ claim: Reimbursement; action: "approved" | "rejected" } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Reimbursement | null>(null);

  const tabs = [
    { key: "mine", label: "My Claims", icon: Send },
    canApprove && { key: "approvals", label: "Approvals", icon: ClipboardList },
    canView && { key: "all", label: "All Claims", icon: ListChecks },
  ].filter(Boolean) as { key: string; label: string; icon: React.ElementType }[];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : (tabs[0]?.key ?? "mine");

  const mine = mineData?.data ?? [];
  const all = allData?.data ?? [];
  const pending = pendingData?.data ?? [];

  const openNew = () => { setSelected(null); setDialogOpen(true); };

  const claimTable = (rows: Reimbursement[], opts: { showEmployee?: boolean; showActions?: boolean; showReview?: boolean; loading: boolean; empty: string }) => (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              {opts.showEmployee && <th className="px-4 py-3 font-medium">Employee</th>}
              <th className="px-4 py-3 font-medium">Claim</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Expense date</th>
              <th className="px-4 py-3 font-medium">Payout</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {opts.loading ? (
              <tr><td colSpan={opts.showEmployee ? 8 : 7} className="py-14 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={opts.showEmployee ? 8 : 7} className="py-14 text-center text-muted-foreground"><Receipt className="mx-auto mb-2 h-7 w-7" />{opts.empty}</td></tr>
            ) : rows.map((r) => {
              const e = empOf(r);
              return (
                <tr key={r._id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  {opts.showEmployee && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{getInitials(e?.name ?? "?")}</div>
                        <div className="min-w-0"><p className="truncate font-medium">{e?.name ?? "—"}</p><p className="truncate text-xs text-muted-foreground">{e?.employeeCode ?? ""}</p></div>
                      </div>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <p className="font-medium">{r.title}</p>
                    {r.description && <p className="max-w-[220px] truncate text-xs text-muted-foreground">{r.description}</p>}
                  </td>
                  <td className="px-4 py-3">{REIMBURSEMENT_CATEGORY_LABELS[r.category]}</td>
                  <td className="px-4 py-3">{fmtDate(r.expenseDate)}</td>
                  <td className="px-4 py-3">{r.month}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{money(r.amount, e?.currency)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                    {workflowStepLabel(r) && <span className="ml-1.5 text-[11px] text-muted-foreground">{workflowStepLabel(r)}</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {opts.showReview && r.status === "pending" && canActOnWorkflowStep(r, reviewerRoleId, isSuperAdmin) && (
                        <>
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-emerald-600" onClick={() => setReviewTarget({ claim: r, action: "approved" })}><Check className="h-3.5 w-3.5" />Approve</Button>
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-red-600" onClick={() => setReviewTarget({ claim: r, action: "rejected" })}><X className="h-3.5 w-3.5" />Reject</Button>
                        </>
                      )}
                      {opts.showActions && r.status === "pending" && (
                        <>
                          {(canEdit || r.status === "pending") && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setSelected(r); setDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button>}
                          {(canDelete || r.status === "pending") && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(r)}><Trash2 className="h-4 w-4" /></Button>}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );

  return (
    <div>
      <PageHeader
        title="Reimbursements"
        description="Submit expense claims and get them approved and paid through payroll."
        icon={Receipt}
        action={canCreate && <Button onClick={openNew} className="shadow-sm"><Plus className="h-4 w-4" />New Claim</Button>}
      />

      <Tabs tabs={tabs} value={activeTab} onChange={setTab} />

      {activeTab === "mine" && claimTable(mine, { showActions: true, loading: mineLoading, empty: "You haven't filed any claims yet." })}

      {activeTab === "approvals" && claimTable(pending, { showEmployee: true, showReview: true, loading: pendingLoading, empty: "No claims awaiting approval 🎉" })}

      {activeTab === "all" && (
        <div className="space-y-4">
          <Card className="flex flex-wrap items-end gap-4 p-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All status</SelectItem>
                  {(Object.keys(REIMBURSEMENT_STATUS_LABELS) as ReimbursementStatus[]).map((s) => <SelectItem key={s} value={s}>{REIMBURSEMENT_STATUS_LABELS[s]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Payout month</Label>
              <Input type="month" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="h-9 w-[160px]" />
            </div>
          </Card>
          {claimTable(all, { showEmployee: true, showReview: canApprove, showActions: canEdit || canDelete, loading: allLoading, empty: "No claims match these filters." })}
        </div>
      )}

      <ReimbursementDialog open={dialogOpen} onOpenChange={setDialogOpen} claim={selected} canFileForOthers={canApprove} defaultMonth={monthFilter || undefined} />

      <ReviewDialog
        open={!!reviewTarget} onOpenChange={(o) => !o && setReviewTarget(null)}
        action={reviewTarget?.action ?? "approved"}
        subject={reviewTarget ? `${empOf(reviewTarget.claim)?.name ?? ""} · ${reviewTarget.claim.title} · ${money(reviewTarget.claim.amount, empOf(reviewTarget.claim)?.currency)}` : undefined}
        isPending={reviewing}
        onConfirm={(note) => reviewTarget && review({ id: reviewTarget.claim._id, data: { status: reviewTarget.action, reviewNote: note || undefined } }, { onSuccess: () => setReviewTarget(null) })}
      />

      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete claim" description="This reimbursement claim will be permanently removed." isPending={deleting}
        onConfirm={() => deleteTarget && remove(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) })}
      />
    </div>
  );
}
