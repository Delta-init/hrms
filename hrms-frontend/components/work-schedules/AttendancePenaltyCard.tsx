"use client";
import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { attendancePenaltyFormSchema, type AttendancePenaltyFormValues } from "@/lib/validations/attendancePenaltySchema";
import { useAttendancePenaltyPolicy, useUpdateAttendancePenaltyPolicy } from "@/hooks/useAttendancePenaltyPolicy";

interface Props {
  /** Whether the caller can edit the policy (workSchedules.edit). */
  canEdit: boolean;
}

const DEFAULTS: AttendancePenaltyFormValues = { enabled: false, graceLates: 3, lateBlockSize: 3, unrecordedDaysUnpaid: false };

export function AttendancePenaltyCard({ canEdit }: Props) {
  const { data: policy, isLoading } = useAttendancePenaltyPolicy();
  const { mutate: update, isPending } = useUpdateAttendancePenaltyPolicy();

  const { register, handleSubmit, control, reset, watch, formState: { errors, isDirty } } = useForm<AttendancePenaltyFormValues>({
    resolver: zodResolver(attendancePenaltyFormSchema),
    defaultValues: DEFAULTS,
  });

  useEffect(() => {
    if (policy) reset(policy);
  }, [policy, reset]);

  const enabled = watch("enabled");
  const graceLates = watch("graceLates");
  const lateBlockSize = watch("lateBlockSize");
  const unrecordedUnpaid = watch("unrecordedDaysUnpaid");

  const onSubmit = (data: AttendancePenaltyFormValues) => update(data);

  if (isLoading) {
    return <Card className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>;
  }

  return (
    <Card className="max-w-xl p-5">
      <div className="mb-1 flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Late-Arrival Penalty</h3></div>
      <p className="mb-4 text-xs text-muted-foreground">
        Repeated lateness beyond a grace count converts into a Loss-of-Pay deduction on the monthly payslip,
        alongside the existing per-shift grace period and half-day threshold.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium">Enable penalty deductions</p>
            <p className="text-[11px] text-muted-foreground">When off, lateness is tracked but never affects pay.</p>
          </div>
          <Controller name="enabled" control={control} render={({ field }) => (
            <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!canEdit} />
          )} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="graceLates">Grace late arrivals / month</Label>
            <Input id="graceLates" type="number" min="0" step="1" disabled={!canEdit} {...register("graceLates")} />
            {errors.graceLates && <p className="text-xs text-destructive">{errors.graceLates.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lateBlockSize">Lates per half-day deduction</Label>
            <Input id="lateBlockSize" type="number" min="1" step="1" disabled={!canEdit} {...register("lateBlockSize")} />
            {errors.lateBlockSize && <p className="text-xs text-destructive">{errors.lateBlockSize.message}</p>}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="pr-3">
            <p className="text-sm font-medium">Days with no attendance are unpaid</p>
            <p className="text-[11px] text-muted-foreground">
              A working day with no attendance record, no approved leave and no holiday against it.
              Leave this off unless attendance is captured every day — a gap in the data usually means
              nobody ran attendance, not that the person stayed away.
            </p>
          </div>
          <Controller name="unrecordedDaysUnpaid" control={control} render={({ field }) => (
            <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!canEdit} />
          )} />
        </div>

        {unrecordedUnpaid && (
          <p className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
            Every unaccounted working day will now reduce pay. Make sure attendance is complete before
            each payroll run, or people will be docked for days nobody recorded.
          </p>
        )}

        <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
          {enabled
            ? `The first ${graceLates || 0} late arrivals each month are free. Every ${lateBlockSize || 1} late arrivals after that deduct half a day's pay.`
            : "Penalty deductions are currently disabled — enable to start applying them from next payroll run."}
        </p>

        {canEdit && (
          <Button type="submit" disabled={isPending || !isDirty} className="w-full sm:w-auto">
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save Changes
          </Button>
        )}
      </form>
    </Card>
  );
}
