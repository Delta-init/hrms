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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { REGULARIZATION_OUTCOMES, ATTENDANCE_STATUS_LABELS } from "@/types";
import { attendancePenaltyFormSchema, type AttendancePenaltyFormValues } from "@/lib/validations/attendancePenaltySchema";
import { useAttendancePenaltyPolicy, useUpdateAttendancePenaltyPolicy } from "@/hooks/useAttendancePenaltyPolicy";

interface Props {
  /** Whether the caller can edit the policy (workSchedules.edit). */
  canEdit: boolean;
}

const DEFAULTS: AttendancePenaltyFormValues = { enabled: false, graceLates: 3, lateBlockSize: 3, unrecordedDaysUnpaid: false, unrecordedFrom: "", monthlyRegularizationLimit: 3, defaultRegularizationStatus: "present" };

export function AttendancePenaltyCard({ canEdit }: Props) {
  const { data: policy, isLoading } = useAttendancePenaltyPolicy();
  const { mutate: update, isPending } = useUpdateAttendancePenaltyPolicy();

  const { register, handleSubmit, control, reset, watch, formState: { errors, isDirty } } = useForm<AttendancePenaltyFormValues>({
    resolver: zodResolver(attendancePenaltyFormSchema),
    defaultValues: DEFAULTS,
  });

  useEffect(() => {
    if (policy) reset({ ...policy, unrecordedFrom: policy.unrecordedFrom ?? "" });
  }, [policy, reset]);

  const enabled = watch("enabled");
  const graceLates = watch("graceLates");
  const lateBlockSize = watch("lateBlockSize");
  const unrecordedUnpaid = watch("unrecordedDaysUnpaid");
  const unrecordedFrom = watch("unrecordedFrom");

  const onSubmit = (data: AttendancePenaltyFormValues) => update({ ...data, unrecordedFrom: data.unrecordedFrom || null });

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
              A working day with no attendance record, no approved leave and no holiday against it is
              marked absent and unpaid, once the day is over. Leave this off unless attendance is
              captured every day: a gap in the data usually means nobody ran attendance, not that the
              person stayed away. Anyone who genuinely doesn&apos;t clock in should be marked
              attendance-exempt first.
            </p>
          </div>
          <Controller name="unrecordedDaysUnpaid" control={control} render={({ field }) => (
            <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!canEdit} />
          )} />
        </div>

        {unrecordedUnpaid && (
          <div className="space-y-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="unrecordedFrom" className="text-xs text-amber-800 dark:text-amber-300">Counts from</Label>
              <Input id="unrecordedFrom" type="date" className="h-8 w-44 bg-background text-foreground" disabled={!canEdit} {...register("unrecordedFrom")} />
            </div>
            <p>
              {unrecordedFrom
                ? `Unrecorded days from ${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${unrecordedFrom}T00:00:00Z`))} are unpaid; earlier ones stay paid, even if an older payslip is rebuilt.`
                : "With no date, every past unrecorded day in a month is unpaid — including in an older month whose payslip gets rebuilt. Set a date to start from."}
            </p>
          </div>
        )}

        <div className="space-y-1.5 border-t border-border pt-4">
          <Label htmlFor="monthlyRegularizationLimit">Corrections allowed per month</Label>
          <Input
            id="monthlyRegularizationLimit" type="number" min="0" step="1" className="sm:w-64"
            disabled={!canEdit} {...register("monthlyRegularizationLimit")}
          />
          {errors.monthlyRegularizationLimit && <p className="text-xs text-destructive">{errors.monthlyRegularizationLimit.message}</p>}
          <p className="text-[11px] text-muted-foreground">
            Past this, a correction goes to the requester&apos;s reporting manager instead of the usual
            approver, and the manager is emailed. It is not a cap — the request still gets made, it just
            gets seen by somebody who would know. Applies whether or not penalties are switched on.
          </p>
        </div>

        <div className="space-y-1.5 border-t border-border pt-4">
          <Label>A correction marks the day as</Label>
          <Controller name="defaultRegularizationStatus" control={control} render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} disabled={!canEdit}>
              <SelectTrigger className="sm:w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REGULARIZATION_OUTCOMES.map((o) => (
                  <SelectItem key={o} value={o}>{ATTENDANCE_STATUS_LABELS[o]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )} />
          <p className="text-[11px] text-muted-foreground">
            What a regularization request starts on. Whoever raises one can still pick a different
            status for that day — this only decides where the form opens.
          </p>
        </div>

        <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
          {enabled
            ? `The first ${graceLates || 0} late arrivals each month are free. Every ${lateBlockSize || 1} late arrivals after that deduct half a day's pay — and the same allowance and rate apply separately to early checkouts, counted on their own.`
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
