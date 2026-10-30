"use client";
import { useEffect, useState } from "react";
import { Loader2, Minus, Plus, RotateCcw } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSetLopOverride } from "@/hooks/usePayslips";
import type { LopOverride } from "@/types";

export interface LopTarget {
  employee: { _id: string; name: string };
  month: string;
  /** What the payslip charges now — HR's figure if one is set, else attendance's. */
  days: number;
  /** What attendance alone comes to. */
  attendanceDays: number;
  override?: LopOverride | null;
  /** The most that can be charged — the month's working days. */
  maxDays?: number;
}

const fmtMonth = (m: string) => {
  const [y, mm] = m.split("-").map(Number);
  return new Date(y, mm - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
};

/**
 * HR's own loss-of-pay figure for one person's month.
 *
 * Attendance sometimes has it wrong — a day marked present on approved leave,
 * a leave cancelled after the fact — and the payslip used to recompute the
 * figure on every save, so nothing typed into it stuck. This sets it once, with
 * a reason, and every payroll screen follows it until it is reset.
 */
export function LopOverrideDialog({ target, onClose, onSaved }: { target: LopTarget | null; onClose: () => void; onSaved?: () => void }) {
  const { mutate: save, isPending } = useSetLopOverride();
  const [days, setDays] = useState(0);
  const [reason, setReason] = useState("");
  // Kept through the closing animation, so the text does not blank as it fades.
  const [shown, setShown] = useState<LopTarget | null>(null);

  useEffect(() => {
    if (target) { setShown(target); setDays(target.days); setReason(target.override?.reason ?? ""); }
  }, [target]);

  const max = Math.max(shown?.maxDays ?? 31, shown?.attendanceDays ?? 0);
  const valid = days >= 0 && days <= max && Number.isInteger(days * 2);
  const ready = !!target && valid && reason.trim().length >= 3;
  const step = (d: number) => setDays((v) => Math.min(max, Math.max(0, Math.round((v + d) * 2) / 2)));

  const submit = () => {
    if (!target || !ready) return;
    save({ employee: target.employee._id, month: target.month, days, reason: reason.trim() }, { onSuccess: () => { onClose(); onSaved?.(); } });
  };
  const reset = () => {
    if (!target) return;
    save({ employee: target.employee._id, month: target.month, days: null }, { onSuccess: () => { onClose(); onSaved?.(); } });
  };

  return (
    <ResponsiveDialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <ResponsiveDialogContent desktopClassName="max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Loss of pay</ResponsiveDialogTitle>
          {shown && <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">{shown.employee.name} · {fmtMonth(shown.month)}</ResponsiveDialogDescription>}
        </ResponsiveDialogHeader>
        {shown && (
          <div className="space-y-4 px-4 sm:px-0">
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Attendance says <span className="font-semibold text-foreground">{shown.attendanceDays} day{shown.attendanceDays === 1 ? "" : "s"}</span>.
              {shown.override && <> Set to {shown.override.days} by {shown.override.by ?? "HR"}.</>}
            </p>
            <div className="space-y-1.5">
              <Label>Days of loss of pay</Label>
              <div className="flex items-center gap-2">
                <Button type="button" size="icon" variant="outline" aria-label="Half a day fewer" disabled={days <= 0} onClick={() => step(-0.5)}><Minus className="h-4 w-4" /></Button>
                <Input type="number" min={0} max={max} step={0.5} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-24 text-center tabular-nums" />
                <Button type="button" size="icon" variant="outline" aria-label="Half a day more" disabled={days >= max} onClick={() => step(0.5)}><Plus className="h-4 w-4" /></Button>
              </div>
              {!valid && <p className="text-xs text-destructive">Whole or half days, from 0 to {max}.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lop-reason">Reason</Label>
              <Textarea id="lop-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Why it differs from attendance — e.g. worked on 29 Oct, leave cancelled late" />
            </div>
          </div>
        )}
        <ResponsiveDialogFooter>
          {shown?.override && (
            <Button variant="ghost" className="mr-auto gap-1.5" onClick={reset} disabled={isPending}>
              <RotateCcw className="h-4 w-4" />Reset to attendance
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!ready || isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
