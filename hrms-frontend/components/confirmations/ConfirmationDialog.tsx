"use client";
import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, Workflow } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useInitiateConfirmation } from "@/hooks/useConfirmations";
import { LOCATION_LABELS, type DueConfirmation, type EmployeeLocation } from "@/types";

const fmtDate = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—";
const toDateInput = (iso?: string | Date | null) =>
  iso ? new Date(iso).toISOString().slice(0, 10) : "";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  due: DueConfirmation | null;
}

/** Confirm a probationer — directly, or by routing to the approval chain. */
export function ConfirmationDialog({ open, onOpenChange, due }: Props) {
  const { mutate: initiate, isPending } = useInitiateConfirmation();
  const [confirmationDate, setConfirmationDate] = useState("");
  const [notes, setNotes] = useState("");
  // Which button was pressed — both submit, only the routing differs.
  const [mode, setMode] = useState<"direct" | "workflow" | null>(null);

  useEffect(() => {
    if (!open || !due) return;
    // Default to the probation end date — the date confirmation normally takes effect.
    setConfirmationDate(toDateInput(due.dueDate));
    setNotes("");
    setMode(null);
  }, [open, due]);

  if (!due) return null;
  const e = due.employee;

  const submit = (useWorkflow: boolean) => {
    if (!confirmationDate) return;
    setMode(useWorkflow ? "workflow" : "direct");
    initiate(
      { employee: e._id, confirmationDate, notes: notes || undefined, useWorkflow },
      { onSuccess: () => onOpenChange(false), onSettled: () => setMode(null) }
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Confirm employment</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-5 px-4 pb-2 sm:px-0">
          <div>
            <p className="font-semibold">{e.name}</p>
            <p className="text-sm text-muted-foreground">#{e.employeeCode}</p>
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border text-sm">
            <Cell label="Join date" value={fmtDate(e.joiningDate)} />
            <Cell label="Designation" value={e.designation || "—"} />
            <Cell label="Probation period" value={e.probationPeriodDays ? `${e.probationPeriodDays} days` : "—"} />
            <Cell label="Location" value={e.location ? LOCATION_LABELS[e.location as EmployeeLocation] ?? e.location : "—"} />
          </div>

          <p className={cn("text-sm", due.overdue ? "text-destructive" : "text-muted-foreground")}>
            Probation {due.overdue ? "ended" : "ends"} {fmtDate(due.dueDate)} ·{" "}
            {due.overdue ? `${Math.abs(due.daysLeft)} days overdue` : `in ${due.daysLeft} days`}
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="confirmationDate">Confirmation date</Label>
            <Input
              id="confirmationDate"
              type="date"
              value={confirmationDate}
              onChange={(ev) => setConfirmationDate(ev.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="conf-notes">Notes</Label>
            <Textarea
              id="conf-notes"
              rows={3}
              value={notes}
              onChange={(ev) => setNotes(ev.target.value)}
              placeholder="Optional — performance summary, conditions, anything to record"
            />
          </div>
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Cancel</Button>
          <Button variant="secondary" onClick={() => submit(true)} disabled={isPending || !confirmationDate}>
            {isPending && mode === "workflow" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Workflow className="h-4 w-4" />}
            Send for approval
          </Button>
          <Button onClick={() => submit(false)} disabled={isPending || !confirmationDate}>
            {isPending && mode === "direct" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Confirm employee
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}
