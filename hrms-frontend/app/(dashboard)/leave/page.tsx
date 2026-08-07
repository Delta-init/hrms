"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  CalendarClock, Plus, Pencil, Trash2, Loader2, Check, X,
  CalendarDays, PartyPopper, ListChecks, CalendarRange, Inbox, Send, Wallet, CalendarPlus,
} from "lucide-react";
import { useLeaves, useMyLeaves, useReviewLeave, useDeleteLeave, useWithdrawLeave, useHolidays, useDeleteHoliday } from "@/hooks/useLeaves";
import { useAuth } from "@/hooks/useAuth";
import { useTableQuery } from "@/hooks/useTableQuery";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { LeaveDialog } from "@/components/leave/LeaveDialog";
import { HolidayDialog } from "@/components/leave/HolidayDialog";
import { LeaveCalendar } from "@/components/leave/LeaveCalendar";
import { LeaveBalances } from "@/components/leave/LeaveBalances";
import { CompOffLedger } from "@/components/leave/CompOffLedger";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ReviewDialog } from "@/components/shared/ReviewDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserSelect } from "@/components/pickers";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials, cn } from "@/lib/utils";
import { canActOnWorkflowStep, workflowStepLabel } from "@/lib/workflow";
import { LEAVE_TYPE_LABELS, type LeaveRequest, type LeaveStatus, type LeaveType, leaveTypeLabel, BUILTIN_LEAVE_TYPES } from "@/types";

const ALL = "__all__";
const statusStyles: Record<LeaveStatus, string> = {
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  rejected: "bg-red-500/10 text-red-600 border-red-500/20",
  cancelled: "bg-muted text-muted-foreground border-border",
};
const fmtDate = (iso: string, tz?: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: tz }).format(new Date(iso));

// Simple table for Approvals / My tabs (bounded lists).
function SimpleLeaveTable({ leaves, loading, emptyText, canApprove, onReview, reviewerRoleId, isSuperAdmin, onWithdraw, withdrawing }: {
  leaves: LeaveRequest[]; loading?: boolean; emptyText: string; canApprove?: boolean;
  onReview?: (l: LeaveRequest, a: "approved" | "rejected") => void;
  reviewerRoleId?: string; isSuperAdmin?: boolean;
  onWithdraw?: (l: LeaveRequest) => void; withdrawing?: boolean;
}) {
  const showActions = canApprove || !!onWithdraw;
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-3 font-semibold">Employee</th><th className="px-5 py-3 font-semibold">Type</th>
              <th className="px-5 py-3 font-semibold">Dates</th><th className="px-5 py-3 font-semibold">Days</th>
              <th className="px-5 py-3 font-semibold">Status</th>{showActions && <th className="px-5 py-3 text-right font-semibold">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? <tr><td colSpan={6} className="px-5 py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></td></tr>
            : leaves.length === 0 ? <tr><td colSpan={6} className="px-5 py-16 text-center text-muted-foreground">{emptyText}</td></tr>
            : leaves.map((l) => {
              const name = l.user && typeof l.user === "object" ? l.user.name : "—";
              return (
                <tr key={l._id} className="hover:bg-muted/30">
                  <td className="px-5 py-3.5"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{getInitials(name)}</div><span className="font-medium">{name}</span></div></td>
                  <td className="px-5 py-3.5">{leaveTypeLabel(l.type)}</td>
                  <td className="px-5 py-3.5 text-xs text-muted-foreground">{fmtDate(l.startDate, l.timeZone)} → {fmtDate(l.endDate, l.timeZone)}</td>
                  <td className="px-5 py-3.5 font-medium">{l.days}</td>
                  <td className="px-5 py-3.5">
                    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", statusStyles[l.status])}>{l.status}</span>
                    {workflowStepLabel(l) && <span className="ml-1.5 text-[11px] text-muted-foreground">{workflowStepLabel(l)}</span>}
                  </td>
                  {showActions && (
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        {canApprove && l.status === "pending" && canActOnWorkflowStep(l, reviewerRoleId, isSuperAdmin) && <>
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-emerald-600" onClick={() => onReview?.(l, "approved")}><Check className="h-3.5 w-3.5" />Approve</Button>
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-red-600" onClick={() => onReview?.(l, "rejected")}><X className="h-3.5 w-3.5" />Reject</Button>
                        </>}
                        {onWithdraw && l.status === "pending" && (
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-muted-foreground hover:text-destructive" disabled={withdrawing} onClick={() => onWithdraw(l)}>
                            <X className="h-3.5 w-3.5" />Withdraw
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function LeavePage() {
  const { user, hasPermission } = useAuth();
  const canView = hasPermission("leave", "view");
  const canCreate = hasPermission("leave", "create");
  const canApprove = hasPermission("leave", "approve");
  const canEdit = hasPermission("leave", "edit");
  const canDelete = hasPermission("leave", "delete");
  const reviewerRoleId = user?.role?._id;
  const isSuperAdmin = !!user?.role?.isSystemRole && user?.role?.roleName === "Super Admin";

  const [tab, setTab] = useState("requests");
  const query = useTableQuery({ defaultSortBy: "createdAt", defaultSortOrder: "desc" });

  const { data: reqData, isLoading: reqLoading, isFetching } = useLeaves(canApprove ? query.params : undefined);
  const { data: allData } = useLeaves(canApprove ? { limit: "500" } : undefined);
  const { data: pendingData } = useLeaves(canApprove ? { status: "pending", limit: "200" } : undefined);
  const { data: mineData, isLoading: mineLoading } = useMyLeaves({ limit: "200" });
  const { data: holidayData } = useHolidays({ limit: "200" });

  const { mutate: reviewLeave, isPending: reviewing } = useReviewLeave();
  const { mutate: removeLeave, isPending: deleting } = useDeleteLeave();
  const { mutate: withdrawLeave, isPending: withdrawing } = useWithdrawLeave();
  const { mutate: removeHoliday } = useDeleteHoliday();

  const pending = pendingData?.data ?? [];
  const mine = mineData?.data ?? [];
  const holidays = holidayData?.data ?? [];
  const calendarLeaves = allData?.data ?? mine;

  const [leaveDialog, setLeaveDialog] = useState(false);
  const [applyDialog, setApplyDialog] = useState(false);
  const [holidayDialog, setHolidayDialog] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<LeaveRequest | null>(null);
  const [review, setReview] = useState<{ leave: LeaveRequest; action: "approved" | "rejected" } | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<LeaveRequest | null>(null);

  const tabs = [
    canApprove && { key: "requests", label: "Requests", icon: ListChecks },
    canView && { key: "calendar", label: "Calendar", icon: CalendarRange },
    canApprove && { key: "approvals", label: "Approvals", icon: Inbox, count: pending.length },
    { key: "apply", label: "Apply", icon: Send },
    { key: "balances", label: "Balances", icon: Wallet },
    { key: "comp-off", label: "Comp-Off", icon: CalendarPlus },
    canView && { key: "holidays", label: "Holidays", icon: CalendarDays },
  ].filter(Boolean) as { key: string; label: string; icon: React.ElementType; count?: number }[];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : (tabs[0]?.key ?? "apply");

  const columns: DataTableColumn<LeaveRequest>[] = [
    {
      id: "employee", label: "Employee", alwaysVisible: true,
      render: (l) => { const name = l.user && typeof l.user === "object" ? l.user.name : "—"; return <div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{getInitials(name)}</div><span className="font-medium">{name}</span></div>; },
    },
    { id: "type", label: "Type", sortKey: "type", render: (l) => <>{leaveTypeLabel(l.type)}{l.halfDay && <span className="ml-1 text-xs text-muted-foreground">(½)</span>}</> },
    { id: "dates", label: "Dates", sortKey: "startDate", render: (l) => <span className="text-xs text-muted-foreground">{fmtDate(l.startDate, l.timeZone)} → {fmtDate(l.endDate, l.timeZone)}</span> },
    { id: "days", label: "Days", sortKey: "days", render: (l) => <span className="font-medium">{l.days}</span> },
    {
      id: "status", label: "Status", sortKey: "status",
      render: (l) => (
        <>
          <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", statusStyles[l.status])}>{l.status}</span>
          {workflowStepLabel(l) && <span className="ml-1.5 text-[11px] text-muted-foreground">{workflowStepLabel(l)}</span>}
        </>
      ),
    },
    { id: "reviewedBy", label: "Reviewed by", defaultVisible: false, render: (l) => <span className="text-muted-foreground">{typeof l.reviewedBy === "object" && l.reviewedBy ? l.reviewedBy.name : "—"}</span> },
    {
      id: "actions", label: "", alwaysVisible: true, align: "right",
      render: (l) => (
        <div className="flex items-center justify-end gap-1">
          {canApprove && l.status === "pending" && canActOnWorkflowStep(l, reviewerRoleId, isSuperAdmin) && <>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-emerald-600" onClick={() => setReview({ leave: l, action: "approved" })}><Check className="h-3.5 w-3.5" />Approve</Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-red-600" onClick={() => setReview({ leave: l, action: "rejected" })}><X className="h-3.5 w-3.5" />Reject</Button>
          </>}
          {(canEdit || canDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><Pencil className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && <DropdownMenuItem onClick={() => { setSelected(l); setLeaveDialog(true); }} className="cursor-pointer"><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>}
                {canDelete && <DropdownMenuItem onClick={() => { setSelected(l); setDeleteOpen(true); }} className="cursor-pointer text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      ),
    },
  ];

  const filters = (
    <>
      <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Employee</Label>
        <UserSelect value={query.filters.user} onChange={(v) => query.setFilter("user", v)} placeholder="All employees" allowClear className="h-9 w-[160px]" />
      </div>
      <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Status</Label>
        <Select value={query.filters.status ?? ALL} onValueChange={(v) => query.setFilter("status", v)}><SelectTrigger className="h-9 w-[130px]"><SelectValue placeholder="All" /></SelectTrigger><SelectContent><SelectItem value={ALL}>All status</SelectItem>{(["pending", "approved", "rejected", "cancelled"] as LeaveStatus[]).map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent></Select>
      </div>
      <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Type</Label>
        <Select value={query.filters.type ?? ALL} onValueChange={(v) => query.setFilter("type", v)}><SelectTrigger className="h-9 w-[130px]"><SelectValue placeholder="All" /></SelectTrigger><SelectContent><SelectItem value={ALL}>All types</SelectItem>{BUILTIN_LEAVE_TYPES.map((t) => <SelectItem key={t} value={t}>{LEAVE_TYPE_LABELS[t]}</SelectItem>)}</SelectContent></Select>
      </div>
      <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">From</Label><Input type="date" value={query.filters.dateFrom ?? ""} onChange={(e) => query.setFilter("dateFrom", e.target.value)} className="h-9 w-[150px]" /></div>
      <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">To</Label><Input type="date" value={query.filters.dateTo ?? ""} onChange={(e) => query.setFilter("dateTo", e.target.value)} className="h-9 w-[150px]" /></div>
    </>
  );

  return (
    <div>
      <PageHeader
        title="Leave"
        description="Requests, approvals, calendar and the holiday calendar."
        icon={CalendarClock}
        action={canView && canCreate && activeTab === "requests" && <Button onClick={() => { setSelected(null); setLeaveDialog(true); }} className="shadow-sm"><Plus className="h-4 w-4" />New Request</Button>}
      />

      <Tabs tabs={tabs} value={activeTab} onChange={setTab} />

      {activeTab === "requests" && (
        <DataTable
          tableId="leave-requests" columns={columns} rows={reqData?.data ?? []} rowKey={(l) => l._id}
          loading={reqLoading || isFetching} pagination={reqData?.pagination} query={query}
          searchable={false} filters={filters} rowLabel="requests" emptyText="No leave requests match the filters." minWidth={720}
          exportName="leave-requests"
          exportMapper={(l) => ({
            Employee: l.user && typeof l.user === "object" ? l.user.name : "",
            Type: leaveTypeLabel(l.type), Start: fmtDate(l.startDate, l.timeZone), End: fmtDate(l.endDate, l.timeZone),
            Days: l.days, HalfDay: l.halfDay ? "Yes" : "No", Status: l.status,
            ReviewedBy: typeof l.reviewedBy === "object" && l.reviewedBy ? l.reviewedBy.name : "",
          })}
        />
      )}

      {activeTab === "calendar" && <Card className="p-5"><LeaveCalendar leaves={calendarLeaves} holidays={holidays} /></Card>}

      {activeTab === "approvals" && <SimpleLeaveTable leaves={pending} emptyText="No pending requests 🎉" canApprove={canApprove} onReview={(l, a) => setReview({ leave: l, action: a })} reviewerRoleId={reviewerRoleId} isSuperAdmin={isSuperAdmin} />}

      {activeTab === "apply" && (
        <div className="space-y-4">
          <Card className="flex items-center justify-between p-5">
            <div><h3 className="text-base font-semibold">Apply for leave</h3><p className="text-sm text-muted-foreground">Submit a leave request for yourself. It goes to your manager for approval.</p></div>
            <Button onClick={() => setApplyDialog(true)}><Plus className="h-4 w-4" />Apply</Button>
          </Card>
          <div><h4 className="mb-2 text-sm font-semibold text-muted-foreground">My Requests</h4><SimpleLeaveTable leaves={mine} loading={mineLoading} emptyText="You haven't applied for any leave yet." onWithdraw={setWithdrawTarget} withdrawing={withdrawing} /></div>
        </div>
      )}

      {activeTab === "balances" && <LeaveBalances canManage={canEdit} />}

      {activeTab === "comp-off" && <CompOffLedger canManage={canApprove} />}

      {activeTab === "holidays" && (
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Holiday Calendar</h3></div>
            {canCreate && <Button size="sm" variant="outline" className="h-8" onClick={() => setHolidayDialog(true)}><Plus className="h-3.5 w-3.5" />Add</Button>}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {holidays.length === 0 ? <p className="col-span-2 py-6 text-center text-sm text-muted-foreground">No holidays added.</p>
            : holidays.map((h) => (
              <div key={h._id} className="group flex items-center gap-3 rounded-lg border border-border p-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><PartyPopper className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{h.name}</p><p className="text-xs text-muted-foreground">{fmtDate(h.date, h.timeZone)} · {h.type}{h.recurring ? " · yearly" : ""}</p></div>
                {canDelete && <button onClick={() => removeHoliday(h._id)} className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"><Trash2 className="h-4 w-4" /></button>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <LeaveDialog open={leaveDialog} onOpenChange={setLeaveDialog} leave={selected} />
      <LeaveDialog open={applyDialog} onOpenChange={setApplyDialog} lockToUserId={user?._id} />
      <HolidayDialog open={holidayDialog} onOpenChange={setHolidayDialog} />
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title="Delete leave request" description="This leave request will be permanently removed." isPending={deleting} onConfirm={() => selected && removeLeave(selected._id, { onSuccess: () => setDeleteOpen(false) })} />
      <ConfirmDialog
        open={!!withdrawTarget} onOpenChange={(o) => !o && setWithdrawTarget(null)}
        title="Withdraw leave request" description="This request will be marked as cancelled. You can apply again if you still need the time off."
        confirmLabel="Withdraw"
        isPending={withdrawing}
        onConfirm={() => withdrawTarget && withdrawLeave(withdrawTarget._id, { onSuccess: () => setWithdrawTarget(null) })}
      />
      <ReviewDialog open={!!review} onOpenChange={(o) => !o && setReview(null)} action={review?.action ?? "approved"} subject={review ? `${review.leave.user && typeof review.leave.user === "object" ? review.leave.user.name : ""} · ${leaveTypeLabel(review.leave.type)}` : undefined} isPending={reviewing} onConfirm={(note) => review && reviewLeave({ id: review.leave._id, data: { status: review.action, reviewNote: note || undefined } }, { onSuccess: () => setReview(null) })} />
    </div>
  );
}
