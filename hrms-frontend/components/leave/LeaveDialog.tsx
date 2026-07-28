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
import { leaveFormSchema, type LeaveFormValues } from "@/lib/validations/leaveSchema";
import { useCreateLeave, useUpdateLeave } from "@/hooks/useLeaves";
import { useUsers } from "@/hooks/useUsers";
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
  const { data: usersData } = useUsers(selfMode ? undefined : { limit: "100" });
  const users = usersData?.data ?? [];
  const { mutate: create, isPending: creating } = useCreateLeave();
  const { mutate: update, isPending: updating } = useUpdateLeave();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, setValue, formState: { errors } } = useForm<LeaveFormValues>({
    resolver: zodResolver(leaveFormSchema),
    defaultValues: { user: "", type: "annual", startDate: "", endDate: "", halfDay: false, timeZone: "Asia/Dubai", reason: "" },
  });

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
          <div className={`col-span-2 space-y-1.5 ${selfMode ? "hidden" : ""}`}>
            <Label>Employee *</Label>
            <Controller
              name="user"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(v) => {
                    field.onChange(v);
                    const u = users.find((x) => x._id === v);
                    if (u && typeof u.workSchedule === "object" && u.workSchedule?.timeZone) {
                      setValue("timeZone", u.workSchedule.timeZone);
                    }
                  }}
                  disabled={isEditing}
                >
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {users.map((u) => <SelectItem key={u._id} value={u._id}>{u.name} — {u.email}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.user && <p className="text-xs text-destructive">{errors.user.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Leave Type</Label>
            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]).map((t) => (
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
