"use client";
import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmployeeSelect } from "@/components/pickers";
import { grantCompOffFormSchema, type GrantCompOffFormValues } from "@/lib/validations/compOffSchema";
import { useGrantCompOff } from "@/hooks/useCompOff";
import type { CompOffSuggestion } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill from a suggestion (attendance-detected off-day worked). */
  prefill?: CompOffSuggestion | null;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export function GrantCompOffDialog({ open, onOpenChange, prefill }: Props) {
  const { mutate: grant, isPending } = useGrantCompOff();

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<GrantCompOffFormValues>({
    resolver: zodResolver(grantCompOffFormSchema),
    defaultValues: { employee: "", date: todayISO(), amount: 1, reason: "" },
  });

  useEffect(() => {
    if (!open) return;
    if (prefill) {
      reset({
        employee: prefill.employee._id, date: prefill.date.slice(0, 10), amount: 1,
        reason: `Worked a ${prefill.reason === "holiday" ? "holiday" : "weekend"} (${Math.round(prefill.workedMinutes / 60)}h logged)`,
      });
    } else {
      reset({ employee: "", date: todayISO(), amount: 1, reason: "" });
    }
  }, [open, prefill, reset]);

  const onSubmit = (data: GrantCompOffFormValues) => {
    const payload = { ...data, reason: data.reason || undefined };
    grant(payload, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Credit Comp-Off</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Employee *</Label>
            <Controller name="employee" control={control} render={({ field }) => (
              <EmployeeSelect
                value={field.value}
                onChange={field.onChange}
                disabled={!!prefill}
                placeholder="Select employee"
              />
            )} />
            {errors.employee && <p className="text-xs text-destructive">{errors.employee.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="date">Date worked *</Label>
              <Input id="date" type="date" {...register("date")} />
              {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount">Days *</Label>
              <Input id="amount" type="number" min="0.5" max="5" step="0.5" {...register("amount")} />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" rows={2} placeholder="Optional" {...register("reason")} />
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}Credit</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
