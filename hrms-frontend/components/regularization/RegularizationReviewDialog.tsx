"use client";
import { useEffect, useState } from "react";
import { Loader2, Check, X, LogIn, LogOut } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { REGULARIZATION_OUTCOMES, ATTENDANCE_STATUS_LABELS, REGULARIZATION_TYPE_LABELS, type Regularization, type RegularizationOutcome } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: Regularization | null;
  action: "approved" | "rejected";
  isPending?: boolean;
  onConfirm: (note: string, resultingStatus: RegularizationOutcome) => void;
}

const fmtDate = (iso: string, tz?: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: tz }).format(new Date(iso));
const fmtTime = (iso?: string | null, tz?: string) =>
  iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso)) : "—";

/**
 * Reviewing a regularization, unlike every other approval in the system,
 * rewrites a day of attendance outright — so the shared ReviewDialog isn't
 * enough. This one says which status the day will carry, and lets the approver
 * correct it here rather than rejecting the request over a wrong dropdown.
 */
export function RegularizationReviewDialog({ open, onOpenChange, record, action, isPending, onConfirm }: Props) {
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<RegularizationOutcome>("present");
  const approving = action === "approved";

  useEffect(() => {
    if (open && record) {
      setNote("");
      setStatus(record.resultingStatus ?? "present");
    }
  }, [open, record]);

  const name = record?.user && typeof record.user === "object" ? record.user.name : "";
  const changed = !!record && status !== (record.resultingStatus ?? "present");

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{approving ? "Approve" : "Reject"} request</ResponsiveDialogTitle>
          {record && (
            <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
              {name} · {fmtDate(record.date, record.timeZone)}
            </ResponsiveDialogDescription>
          )}
        </ResponsiveDialogHeader>

        <div className="space-y-4 px-4 sm:px-0">
          {record && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Correction</span>
                <span className="font-medium">{REGULARIZATION_TYPE_LABELS[record.type]}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-muted-foreground">Corrected times</span>
                <span>
                  <span className="inline-flex items-center gap-1 text-emerald-600"><LogIn className="h-3 w-3" />{fmtTime(record.requestedCheckIn, record.timeZone)}</span>
                  <span className="mx-1 text-muted-foreground">/</span>
                  <span className="inline-flex items-center gap-1 text-rose-500"><LogOut className="h-3 w-3" />{fmtTime(record.requestedCheckOut, record.timeZone)}</span>
                </span>
              </div>
              {record.reason && (
                <p className="mt-2 border-t border-border pt-2 text-muted-foreground">{record.reason}</p>
              )}
            </div>
          )}

          {/* Only meaningful when approving — a rejection leaves the day alone. */}
          {approving && (
            <div className="space-y-1.5">
              <Label>Mark the day as</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as RegularizationOutcome)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REGULARIZATION_OUTCOMES.map((o) => (
                    <SelectItem key={o} value={o}>{ATTENDANCE_STATUS_LABELS[o]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Approving marks{" "}
                {record && <span className="font-medium text-foreground">{fmtDate(record.date, record.timeZone)}</span>} as{" "}
                <span className="font-medium text-foreground">{ATTENDANCE_STATUS_LABELS[status]}</span> and applies the corrected times.
                {changed && " Changed from what was requested."}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reviewNote">Note {approving ? "(optional)" : ""}</Label>
            <Textarea
              id="reviewNote" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={approving ? "Add an optional note…" : "Reason for rejection…"}
            />
          </div>
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Cancel</Button>
          <Button
            onClick={() => onConfirm(note, status)}
            disabled={isPending}
            className={approving ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : approving ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            {approving ? "Approve" : "Reject"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
