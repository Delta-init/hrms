"use client";
import { useEffect, useState } from "react";
import { Plus, Check, X, UserMinus, Undo2, Trash2, LogOut, Loader2, DoorOpen } from "lucide-react";
import { useResignations, useReviewResignation, useWithdrawResignation, useRelieveResignation, useDeleteResignation, useSetExitDetails } from "@/hooks/useResignations";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResignationDialog } from "@/components/resignations/ResignationDialog";
import { ReviewDialog } from "@/components/shared/ReviewDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { cn } from "@/lib/utils";
import { RESIGNATION_STATUS_LABELS, RESIGNATION_TYPE_LABELS, PAYMENT_TYPE_LABELS, type Resignation, type ResignationStatus, type PaymentType } from "@/types";

const statusStyles: Record<ResignationStatus, string> = {
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  accepted: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  rejected: "bg-red-500/10 text-red-600 border-red-500/20",
  withdrawn: "bg-muted text-muted-foreground border-border",
  relieved: "bg-violet-500/10 text-violet-600 border-violet-500/20",
};
const fmtDate = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—");

interface Props {
  employee: { _id: string; name: string; employeeCode?: string; noticePeriodDays?: number };
}

export function EmployeeResignation({ employee }: Props) {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("resignations", "create");
  const canApprove = hasPermission("resignations", "approve");
  const canEdit = hasPermission("resignations", "edit");
  const canDelete = hasPermission("resignations", "delete");

  const { data, isLoading } = useResignations({ employee: employee._id, limit: "20", sortBy: "createdAt", sortOrder: "desc" });
  const rows = (data?.data ?? []) as Resignation[];
  const current = rows.find((r) => r.status === "pending" || r.status === "accepted") ?? null;
  const history = rows.filter((r) => r !== current);

  const { mutate: review, isPending: reviewing } = useReviewResignation();
  const { mutate: withdraw, isPending: withdrawing } = useWithdrawResignation();
  const { mutate: relieve, isPending: relieving } = useRelieveResignation();
  const { mutate: remove, isPending: deleting } = useDeleteResignation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<{ r: Resignation; action: "approved" | "rejected" } | null>(null);
  const [relieveTarget, setRelieveTarget] = useState<Resignation | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<Resignation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Resignation | null>(null);

  if (isLoading) {
    return <Card className="p-12 text-center text-sm text-muted-foreground">Loading…</Card>;
  }

  const detail = (r: Resignation) => (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
      <Field label="Type" value={RESIGNATION_TYPE_LABELS[r.resignationType]} />
      <Field label="Submitted on" value={fmtDate(r.resignationDate)} />
      <Field label="Notice required" value={r.noticeRequired ? "Yes" : "No (immediate)"} />
      <Field label="Notice period" value={r.noticeRequired ? `${r.noticePeriodDays} days` : "—"} />
      <Field label="Last working day" value={fmtDate(r.lastWorkingDay)} />
      <Field label="Reason for leaving" value={r.reason || "—"} className="col-span-2 sm:col-span-3" />
    </div>
  );

  return (
    <div className="space-y-4">
      {current ? (
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <LogOut className="h-4 w-4 text-primary" />
              <span className="font-semibold">Current resignation</span>
              <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[current.status])}>
                {RESIGNATION_STATUS_LABELS[current.status]}
              </span>
            </div>
          </div>
          {detail(current)}

          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
            {current.status === "pending" && canApprove && (
              <>
                <Button size="sm" onClick={() => setReviewTarget({ r: current, action: "approved" })}><Check className="h-4 w-4" />Accept</Button>
                <Button size="sm" variant="outline" onClick={() => setReviewTarget({ r: current, action: "rejected" })}><X className="h-4 w-4" />Reject</Button>
              </>
            )}
            {current.status === "accepted" && canApprove && (
              <Button size="sm" onClick={() => setRelieveTarget(current)}><UserMinus className="h-4 w-4" />Relieve</Button>
            )}
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setWithdrawTarget(current)}><Undo2 className="h-4 w-4" />Withdraw</Button>
            )}
            {canDelete && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(current)}><Trash2 className="h-4 w-4" />Delete</Button>
            )}
          </div>
        </Card>
      ) : (
        <Card className="p-12 text-center">
          <LogOut className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">No active resignation</p>
          <p className="mt-1 text-sm text-muted-foreground">Record a resignation to start tracking this employee&apos;s notice period.</p>
          {canCreate && <Button className="mt-4" onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4" />Record Resignation</Button>}
        </Card>
      )}

      {current && ["accepted", "relieved"].includes(current.status) && canEdit && (
        <ExitDetails resignation={current} />
      )}

      {history.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">History</p>
          <div className="space-y-2">
            {history.map((r) => (
              <Card key={r._id} className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-sm font-medium">{RESIGNATION_TYPE_LABELS[r.resignationType]}</span>
                  <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", statusStyles[r.status])}>
                    {RESIGNATION_STATUS_LABELS[r.status]}
                  </span>
                  {canDelete && <Button size="icon" variant="ghost" className="ml-auto h-7 w-7 text-destructive" onClick={() => setDeleteTarget(r)}><Trash2 className="h-4 w-4" /></Button>}
                </div>
                {detail(r)}
              </Card>
            ))}
          </div>
        </div>
      )}

      <ResignationDialog open={dialogOpen} onOpenChange={setDialogOpen} employee={employee} />
      <ReviewDialog
        open={!!reviewTarget} onOpenChange={(o) => !o && setReviewTarget(null)}
        action={reviewTarget?.action ?? "approved"}
        subject={reviewTarget ? `${employee.name} · last working day ${fmtDate(reviewTarget.r.lastWorkingDay)}` : undefined}
        isPending={reviewing}
        onConfirm={(note) => reviewTarget && review({ id: reviewTarget.r._id, data: { status: reviewTarget.action === "approved" ? "accepted" : "rejected", reviewNote: note || undefined } }, { onSuccess: () => setReviewTarget(null) })}
      />
      <ConfirmDialog
        open={!!relieveTarget} onOpenChange={(o) => !o && setRelieveTarget(null)}
        title="Relieve employee" description={`${employee.name} will be marked relieved and their status set to Terminated.`}
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

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{value}</p>
    </div>
  );
}

const toDateInput = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");

function ExitDetails({ resignation: r }: { resignation: Resignation }) {
  const { mutate: save, isPending } = useSetExitDetails();
  const [leavingDate, setLeavingDate] = useState("");
  const [finalSettlement, setFinalSettlement] = useState("");
  const [left, setLeft] = useState(false);
  const [noticeServed, setNoticeServed] = useState(false);
  const [leaveSalaryPaid, setLeaveSalaryPaid] = useState(false);
  const [ticketAllowancePaid, setTicketAllowancePaid] = useState(false);
  const [paymentType, setPaymentType] = useState<string>("");
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    setLeavingDate(toDateInput(r.leavingDate));
    setFinalSettlement(r.finalSettlement != null ? String(r.finalSettlement) : "");
    setLeft(!!r.left);
    setNoticeServed(!!r.noticePeriodServed);
    setLeaveSalaryPaid(!!r.leaveSalaryPaid);
    setTicketAllowancePaid(!!r.ticketAllowancePaid);
    setPaymentType(r.paymentType ?? "");
    setRemarks(r.remarks ?? "");
  }, [r._id, r.leavingDate, r.finalSettlement, r.left, r.noticePeriodServed, r.leaveSalaryPaid, r.ticketAllowancePaid, r.paymentType, r.remarks]);

  const onSave = () => {
    save({
      id: r._id,
      data: {
        leavingDate: leavingDate || null,
        finalSettlement: finalSettlement === "" ? null : Number(finalSettlement),
        left,
        noticePeriodServed: noticeServed,
        leaveSalaryPaid,
        ticketAllowancePaid,
        paymentType: paymentType || null,
        remarks: remarks || null,
      },
    });
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <DoorOpen className="h-4 w-4 text-primary" />
        <span className="font-semibold">Exit details</span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="leavingDate">Leaving date</Label>
          <Input id="leavingDate" type="date" value={leavingDate} onChange={(e) => setLeavingDate(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="finalSettlement">Final settlement</Label>
          <Input id="finalSettlement" type="number" min="0" step="0.01" placeholder="Amount" value={finalSettlement} onChange={(e) => setFinalSettlement(e.target.value)} />
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between rounded-xl border border-border p-3">
          <div>
            <p className="text-sm font-medium">Notice period served</p>
            <p className="text-[11px] text-muted-foreground">Did the employee serve their full notice?</p>
          </div>
          <Switch checked={noticeServed} onCheckedChange={setNoticeServed} />
        </div>
        <div className="flex items-center justify-between rounded-xl border border-border p-3">
          <div>
            <p className="text-sm font-medium">Left</p>
            <p className="text-[11px] text-muted-foreground">Ticking this marks the employee as gone — status set to Terminated.</p>
          </div>
          <Switch checked={left} onCheckedChange={setLeft} />
        </div>
      </div>

      {/* Leave settlement */}
      <div className="mt-5 rounded-xl border border-border p-3">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-primary">Leave settlement</p>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Leave salary paid</p>
            <Switch checked={leaveSalaryPaid} onCheckedChange={setLeaveSalaryPaid} />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Ticket allowance paid</p>
            <Switch checked={ticketAllowancePaid} onCheckedChange={setTicketAllowancePaid} />
          </div>
          <div className="space-y-1.5">
            <Label>Payment type</Label>
            <Select value={paymentType || undefined} onValueChange={setPaymentType}>
              <SelectTrigger><SelectValue placeholder="Select payment type" /></SelectTrigger>
              <SelectContent>
                {(Object.keys(PAYMENT_TYPE_LABELS) as PaymentType[]).map((p) => (
                  <SelectItem key={p} value={p}>{PAYMENT_TYPE_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="remarks">Remarks</Label>
            <Textarea id="remarks" rows={2} placeholder="Optional notes about the settlement" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button size="sm" onClick={onSave} disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save exit details</Button>
      </div>
    </Card>
  );
}
