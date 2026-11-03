"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRequestCompOff } from "@/hooks/useCompOff";

/** Today as the browser reads it — the latest day anyone can say they worked. */
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Asking for a day back for a weekend or holiday worked.
 *
 * Attendance raises most of these on its own overnight; this is for the day
 * it missed. Either way it waits for HR, and counts toward nothing until then.
 */
export function RequestCompOffDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { mutate: request, isPending } = useRequestCompOff();
  const [date, setDate] = useState(todayLocal());
  const [amount, setAmount] = useState("1");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) { setDate(todayLocal()); setAmount("1"); setReason(""); }
  }, [open]);

  const ready = !!date && date <= todayLocal() && reason.trim().length >= 3;
  const submit = () => {
    if (!ready) return;
    request({ date, amount: Number(amount), reason: reason.trim() }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Request comp-off</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">For a weekend or holiday you worked. HR approves it before it reaches your balance.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-4 px-4 sm:px-0">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="co-date">Day worked</Label>
              <Input id="co-date" type="date" max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Days</Label>
              <Select value={amount} onValueChange={setAmount}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Full day</SelectItem>
                  <SelectItem value="0.5">Half day</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {date > todayLocal() && <p className="text-xs text-destructive">That day has not happened yet.</p>}
          <div className="space-y-1.5">
            <Label htmlFor="co-reason">What you worked on</Label>
            <Textarea id="co-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Admissions event on Sunday" />
          </div>
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!ready || isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}Send to HR</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
