"use client";
import { useEffect } from "react";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { workScheduleFormSchema, type WorkScheduleFormValues } from "@/lib/validations/workScheduleSchema";
import { useCreateWorkSchedule, useUpdateWorkSchedule } from "@/hooks/useWorkSchedules";
import { Switch } from "@/components/ui/switch";
import { TIME_ZONES, WEEKDAYS, LEAVE_TYPE_LABELS, type LeaveType, type WorkSchedule } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule?: WorkSchedule | null;
}

export function WorkScheduleDialog({ open, onOpenChange, schedule }: Props) {
  const isEditing = !!schedule;
  const { mutate: create, isPending: creating } = useCreateWorkSchedule();
  const { mutate: update, isPending: updating } = useUpdateWorkSchedule();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, watch, setValue, formState: { errors } } = useForm<WorkScheduleFormValues>({
    resolver: zodResolver(workScheduleFormSchema),
    defaultValues: {
      name: "", description: "", timeZone: "Asia/Dubai",
      loginTime: "09:00", logoutTime: "18:00", workDays: [1, 2, 3, 4, 5], halfDays: [], graceMinutes: 10,
      leavePolicies: [], status: "active",
    },
  });

  const leave = useFieldArray({ control, name: "leavePolicies" });
  const leaveRows = watch("leavePolicies") ?? [];
  // Only offer types not already listed — one rule per type.
  const unusedTypes = (Object.keys(LEAVE_TYPE_LABELS) as LeaveType[])
    .filter((t) => !leaveRows.some((r) => r.type === t));

  const workDays = watch("workDays");
  const halfDays = watch("halfDays");

  // Cycle a weekday: Off → Full → Half → Off.
  const cycleDay = (idx: number) => {
    const isWork = workDays.includes(idx);
    const isHalf = halfDays.includes(idx);
    if (!isWork) {
      setValue("workDays", [...workDays, idx].sort((a, b) => a - b));
    } else if (!isHalf) {
      setValue("halfDays", [...halfDays, idx].sort((a, b) => a - b));
    } else {
      setValue("workDays", workDays.filter((d) => d !== idx));
      setValue("halfDays", halfDays.filter((d) => d !== idx));
    }
  };

  useEffect(() => {
    if (!open) return;
    if (schedule) {
      reset({
        name: schedule.name,
        description: schedule.description ?? "",
        timeZone: schedule.timeZone,
        loginTime: schedule.loginTime,
        logoutTime: schedule.logoutTime,
        workDays: schedule.workDays,
        halfDays: schedule.halfDays ?? [],
        graceMinutes: schedule.graceMinutes,
        leavePolicies: schedule.leavePolicies ?? [],
        status: schedule.status,
      });
    } else {
      reset({ name: "", description: "", timeZone: "Asia/Dubai", loginTime: "09:00", logoutTime: "18:00", workDays: [1, 2, 3, 4, 5], halfDays: [], graceMinutes: 10, leavePolicies: [], status: "active" });
    }
  }, [open, schedule, reset]);

  const onSubmit = (data: WorkScheduleFormValues) => {
    const payload = { ...data, description: data.description || undefined };
    if (isEditing) update({ id: schedule._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Work Schedule" : "New Work Schedule"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4 px-4 sm:px-0">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="name">Name *</Label>
            <Input id="name" placeholder="e.g. Dubai Day Shift" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Region (Time Zone)</Label>
            <Controller
              name="timeZone"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIME_ZONES.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="loginTime">Login Time *</Label>
            <Input id="loginTime" type="time" {...register("loginTime")} />
            {errors.loginTime && <p className="text-xs text-destructive">{errors.loginTime.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="logoutTime">Logout Time *</Label>
            <Input id="logoutTime" type="time" {...register("logoutTime")} />
            {errors.logoutTime && <p className="text-xs text-destructive">{errors.logoutTime.message}</p>}
          </div>

          {/* Work days — tap to cycle Off → Full → Half */}
          <div className="col-span-2 space-y-1.5">
            <Label>Work Days <span className="font-normal text-muted-foreground">(tap to cycle: off → full → half)</span></Label>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((label, idx) => {
                const isWork = workDays.includes(idx);
                const isHalf = halfDays.includes(idx);
                const state = !isWork ? "off" : isHalf ? "half" : "full";
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => cycleDay(idx)}
                    className={cn(
                      "flex h-11 w-14 flex-col items-center justify-center rounded-lg border text-xs font-medium transition-colors",
                      state === "full" && "border-primary bg-primary text-primary-foreground",
                      state === "half" && "border-amber-400 bg-amber-400/15 text-amber-600",
                      state === "off" && "border-border text-muted-foreground hover:bg-muted"
                    )}
                  >
                    {label}
                    <span className="text-[9px] font-normal uppercase opacity-80">
                      {state === "full" ? "full" : state === "half" ? "half" : "off"}
                    </span>
                  </button>
                );
              })}
            </div>
            {errors.workDays && <p className="text-xs text-destructive">{errors.workDays.message as string}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="graceMinutes">Grace (minutes)</Label>
            <Input id="graceMinutes" type="number" min={0} {...register("graceMinutes")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Input id="description" placeholder="Optional" {...register("description")} />
          </div>

          {/* Leave this schedule grants. Empty means no restriction, so an
              existing schedule keeps behaving as it did until someone sets it. */}
          <div className="col-span-2 space-y-2 rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Label>Leave allowance</Label>
                <p className="text-xs text-muted-foreground">
                  Types on this list are the only ones people on this schedule can request, up to the days
                  shown each month. Unpaid types reduce pay; paid ones don&apos;t. Leave it empty to allow
                  every type without a limit.
                </p>
              </div>
              {unusedTypes.length > 0 && (
                <Button
                  type="button" variant="outline" size="sm"
                  onClick={() => leave.append({ type: unusedTypes[0], monthlyDays: 1, paid: true })}
                >
                  <Plus className="h-3.5 w-3.5" />Add type
                </Button>
              )}
            </div>

            {leave.fields.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                No limits — every leave type is available.
              </p>
            ) : (
              <div className="space-y-2">
                {leave.fields.map((f, i) => (
                  <div key={f.id} className="flex flex-wrap items-center gap-2">
                    <Controller
                      control={control}
                      name={`leavePolicies.${i}.type`}
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(LEAVE_TYPE_LABELS) as LeaveType[])
                              .filter((t) => t === field.value || !leaveRows.some((r) => r.type === t))
                              .map((t) => <SelectItem key={t} value={t}>{LEAVE_TYPE_LABELS[t]}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <div className="flex items-center gap-1.5">
                      <Input type="number" min={0} step="0.5" className="w-20" {...register(`leavePolicies.${i}.monthlyDays`)} />
                      <span className="text-xs text-muted-foreground">days / month</span>
                    </div>
                    <Controller
                      control={control}
                      name={`leavePolicies.${i}.paid`}
                      render={({ field }) => (
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                          {field.value ? "Paid" : "Unpaid"}
                        </label>
                      )}
                    />
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" onClick={() => leave.remove(i)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <ResponsiveDialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Create Schedule"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
