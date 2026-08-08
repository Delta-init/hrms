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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { workScheduleFormSchema, type WorkScheduleFormValues } from "@/lib/validations/workScheduleSchema";
import { useCreateWorkSchedule, useUpdateWorkSchedule } from "@/hooks/useWorkSchedules";
import { Switch } from "@/components/ui/switch";
import { TIME_ZONES, WEEKDAYS, type WorkSchedule } from "@/types";

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
      loginTime: "09:00", logoutTime: "18:00", workDays: [1, 2, 3, 4, 5, 6], halfDays: [], graceMinutes: 10,
      status: "active",
    },
  });

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
        status: schedule.status,
      });
    } else {
      reset({ name: "", description: "", timeZone: "Asia/Dubai", loginTime: "09:00", logoutTime: "18:00", workDays: [1, 2, 3, 4, 5, 6], halfDays: [], graceMinutes: 10, status: "active" });
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

          {/* Leave used to be configured here as well as in Leave → Balances,
              so the same question had two answers. It lives in one place now. */}
          <p className="col-span-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            Leave entitlement is set under <span className="font-medium text-foreground">Leave → Balances</span>,
            where a policy can apply to this schedule or to everyone.
          </p>

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
