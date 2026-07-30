"use client";
import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { leavePolicyFormSchema, type LeavePolicyFormValues } from "@/lib/validations/leavePolicySchema";
import { useCreateLeavePolicy, useUpdateLeavePolicy } from "@/hooks/useLeaveBalances";
import { LEAVE_TYPE_LABELS, type LeavePolicy, type LeaveType } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policy?: LeavePolicy | null;
  /** Leave types with no policy yet — only these are offered when creating. */
  availableTypes: LeaveType[];
}

const EMPTY: LeavePolicyFormValues = { type: "annual", annualDays: 0, accrueMonthly: true, carryForwardLimit: 0 };

export function LeavePolicyDialog({ open, onOpenChange, policy, availableTypes }: Props) {
  const isEditing = !!policy;
  const { mutate: create, isPending: creating } = useCreateLeavePolicy();
  const { mutate: update, isPending: updating } = useUpdateLeavePolicy();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<LeavePolicyFormValues>({
    resolver: zodResolver(leavePolicyFormSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    if (policy) {
      reset({ type: policy.type, annualDays: policy.annualDays, accrueMonthly: policy.accrueMonthly, carryForwardLimit: policy.carryForwardLimit });
    } else {
      reset({ ...EMPTY, type: availableTypes[0] ?? "annual" });
    }
  }, [open, policy, availableTypes, reset]);

  const onSubmit = (data: LeavePolicyFormValues) => {
    if (isEditing) update({ id: policy._id, data }, { onSuccess: () => onOpenChange(false) });
    else create(data, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Leave Policy" : "New Leave Policy"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Leave type *</Label>
            {isEditing ? (
              <div className="flex items-center rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">{LEAVE_TYPE_LABELS[policy.type]}</div>
            ) : (
              <Controller name="type" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{availableTypes.map((t) => <SelectItem key={t} value={t}>{LEAVE_TYPE_LABELS[t]}</SelectItem>)}</SelectContent>
                </Select>
              )} />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="annualDays">Annual entitlement (days) *</Label>
            <Input id="annualDays" type="number" min="0" step="0.5" {...register("annualDays")} />
            {errors.annualDays && <p className="text-xs text-destructive">{errors.annualDays.message}</p>}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Accrue monthly</p>
              <p className="text-[11px] text-muted-foreground">Pro-rate through the year instead of granting it all upfront.</p>
            </div>
            <Controller name="accrueMonthly" control={control} render={({ field }) => (
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            )} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="carryForwardLimit">Carry-forward limit (days)</Label>
            <Input id="carryForwardLimit" type="number" min="0" step="0.5" {...register("carryForwardLimit")} />
            <p className="text-[11px] text-muted-foreground">Max unused days that roll into next year. 0 = no carry-forward.</p>
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isEditing ? "Save Changes" : "Create Policy"}</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
