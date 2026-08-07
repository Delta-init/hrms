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
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserSelect } from "@/components/pickers";
import { leaveFormSchema, type LeaveFormValues } from "@/lib/validations/leaveSchema";
import { useCreateLeave, useUpdateLeave, useLeaveOptions } from "@/hooks/useLeaves";
import { useUser } from "@/hooks/useUsers";
import { LEAVE_TYPE_LABELS, TIME_ZONES, type LeaveRequest, type LeaveType } from "@/types";

/** ISO → YYYY-MM-DD in the record's own timezone, so the edit prefill matches
 *  the list display (avoids a silent off-by-one for zones ahead of UTC). */
function toDateInput(iso?: string | null, tz?: string): string {
  return iso ? new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)) : "";
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leave?: LeaveRequest | null;
  /** When set, the dialog applies for this user only (self-service) — employee picker is hidden. */
  lockToUserId?: string;
}

export function LeaveDialog({ open, onOpenChange, leave, lockToUserId }: Props) {
  const isEditing = !!leave;
  const selfMode = !!lockToUserId && !isEditing;
  const { mutate: create, isPending: creating } = useCreateLeave();
  const { mutate: update, isPending: updating } = useUpdateLeave();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, setValue, watch, formState: { errors } } = useForm<LeaveFormValues>({
    resolver: zodResolver(leaveFormSchema),
    defaultValues: { user: "", type: "annual", startDate: "", endDate: "", halfDay: false, timeZone: "Asia/Dubai", reason: "" },
  });

  // Default the time zone from the picked person's work schedule. Fetched by id
  // rather than looked up in the picker's page, which holds one page of results.
  //
  // Only when creating: an existing request stores the time zone it was filed
  // in, and its dates are rendered against that. Re-applying the person's
  // current schedule on open would silently rewrite it — and shift the dates
  // the user sees — for a request nobody edited.
  const selectedUserId = watch("user");
  const startDate = watch("startDate");

  // What this person may actually request. Types outside their schedule are not
  // offered at all, and the remaining balance is shown so the limit is visible
  // before the form is filled in rather than after it is rejected.
  const { data: leaveOptions } = useLeaveOptions(
    lockToUserId ?? selectedUserId ?? "",
    startDate ? startDate.slice(0, 7) : undefined
  );
  const allowed = leaveOptions && !leaveOptions.unrestricted ? leaveOptions.options : null;
  const { data: selectedUser } = useUser(isEditing ? "" : selectedUserId || "");
  useEffect(() => {
    if (isEditing) return;
    const ws = selectedUser?.workSchedule;
    if (ws && typeof ws === "object" && ws.timeZone) setValue("timeZone", ws.timeZone);
  }, [isEditing, selectedUser, setValue]);

  useEffect(() => {
    if (!open) return;
    if (leave) {
      reset({
        user: leave.user && typeof leave.user === "object" ? leave.user._id : leave.user,
        type: leave.type,
        startDate: toDateInput(leave.startDate, leave.timeZone),
        endDate: toDateInput(leave.endDate, leave.timeZone),
        halfDay: leave.halfDay,
        timeZone: leave.timeZone,
        reason: leave.reason ?? "",
      });
    } else {
      const today = new Date().toISOString().slice(0, 10);
      reset({ user: lockToUserId ?? "", type: "annual", startDate: today, endDate: today, halfDay: false, timeZone: "Asia/Dubai", reason: "" });
    }
  }, [open, leave, reset, lockToUserId]);

  const onSubmit = (data: LeaveFormValues) => {
    const payload: Record<string, unknown> = {
      type: data.type,
      startDate: data.startDate,
      endDate: data.endDate,
      halfDay: data.halfDay,
      timeZone: data.timeZone,
      reason: data.reason || undefined,
    };
    if (isEditing) {
      update({ id: leave._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    } else {
      create({ ...payload, user: lockToUserId ?? data.user }, { onSuccess: () => onOpenChange(false) });
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Leave Request" : "New Leave Request"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4 px-4 sm:px-0">
          {!selfMode && (
            <div className="col-span-2 space-y-1.5">
              <Label>Employee *</Label>
              <Controller
                name="user"
                control={control}
                render={({ field }) => (
                  <UserSelect
                    value={field.value}
                    onChange={field.onChange}
                    disabled={isEditing}
                    placeholder="Select employee"
                  />
                )}
              />
              {errors.user && <p className="text-xs text-destructive">{errors.user.message}</p>}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Leave Type</Label>
            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Select leave type" /></SelectTrigger>
                  <SelectContent>
                    {allowed
                      ? allowed.map((o) => (
                          <SelectItem key={o.type} value={o.type} disabled={o.remaining <= 0}>
                            {LEAVE_TYPE_LABELS[o.type]} · {o.remaining}/{o.monthlyDays} left{o.paid ? "" : " · unpaid"}
                          </SelectItem>
                        ))
                      : (Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]).map((t) => (
                          <SelectItem key={t} value={t}>{LEAVE_TYPE_LABELS[t]}</SelectItem>
                        ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Time Region</Label>
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
            <Label htmlFor="startDate">Start Date *</Label>
            <Input id="startDate" type="date" {...register("startDate")} />
            {errors.startDate && <p className="text-xs text-destructive">{errors.startDate.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="endDate">End Date *</Label>
            <Input id="endDate" type="date" {...register("endDate")} />
            {errors.endDate && <p className="text-xs text-destructive">{errors.endDate.message}</p>}
          </div>

          <div className="col-span-2 flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <Label htmlFor="halfDay">Half day</Label>
              <p className="text-xs text-muted-foreground">Counts as 0.5 day of leave</p>
            </div>
            <Controller
              name="halfDay"
              control={control}
              render={({ field }) => <Switch id="halfDay" checked={field.value} onCheckedChange={field.onChange} />}
            />
          </div>

          {allowed?.length === 0 && (
            <p className="col-span-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              The assigned work schedule grants no leave types, so nothing can be requested. Add an allowance
              to that schedule first.
            </p>
          )}

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" placeholder="Optional reason" rows={2} {...register("reason")} />
          </div>

          <ResponsiveDialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Create Request"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
