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
import { attendanceFormSchema, type AttendanceFormValues } from "@/lib/validations/attendanceSchema";
import { useCreateAttendance, useUpdateAttendance } from "@/hooks/useAttendance";
import { useUsers } from "@/hooks/useUsers";
import { ATTENDANCE_STATUS_LABELS, TIME_ZONES, type Attendance, type AttendanceStatus } from "@/types";

/** ISO (UTC) → value for <input type="datetime-local"> in local time. */
function toLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}
function toDateInput(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attendance?: Attendance | null;
}

export function AttendanceDialog({ open, onOpenChange, attendance }: Props) {
  const isEditing = !!attendance;
  const { data: usersData } = useUsers({ limit: "100" });
  const users = usersData?.data ?? [];
  const { mutate: create, isPending: creating } = useCreateAttendance();
  const { mutate: update, isPending: updating } = useUpdateAttendance();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, setValue, formState: { errors } } = useForm<AttendanceFormValues>({
    resolver: zodResolver(attendanceFormSchema),
    defaultValues: { user: "", date: "", timeZone: "Asia/Dubai", checkIn: "", checkOut: "", status: "present", lateMinutes: 0, note: "" },
  });

  useEffect(() => {
    if (!open) return;
    if (attendance) {
      reset({
        user: attendance.user && typeof attendance.user === "object" ? attendance.user._id : attendance.user,
        date: toDateInput(attendance.date),
        timeZone: attendance.timeZone,
        checkIn: toLocalInput(attendance.checkIn),
        checkOut: toLocalInput(attendance.checkOut),
        status: attendance.status,
        lateMinutes: attendance.lateMinutes,
        note: attendance.note ?? "",
      });
    } else {
      reset({ user: "", date: new Date().toISOString().slice(0, 10), timeZone: "Asia/Dubai", checkIn: "", checkOut: "", status: "present", lateMinutes: 0, note: "" });
    }
  }, [open, attendance, reset]);

  const onSubmit = (data: AttendanceFormValues) => {
    const payload: Record<string, unknown> = {
      date: data.date,
      timeZone: data.timeZone,
      status: data.status,
      lateMinutes: data.lateMinutes ?? 0,
      checkIn: data.checkIn ? new Date(data.checkIn).toISOString() : null,
      checkOut: data.checkOut ? new Date(data.checkOut).toISOString() : null,
      note: data.note || undefined,
    };
    if (isEditing) {
      update({ id: attendance._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    } else {
      create({ ...payload, user: data.user }, { onSuccess: () => onOpenChange(false) });
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Attendance" : "Record Attendance"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4 px-4 sm:px-0">
          {/* Employee */}
          <div className="col-span-2 space-y-1.5">
            <Label>Employee *</Label>
            <Controller
              name="user"
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(v) => {
                    field.onChange(v);
                    // Auto-fill the time region from the employee's work schedule.
                    const u = users.find((x) => x._id === v);
                    if (u && typeof u.workSchedule === "object" && u.workSchedule?.timeZone) {
                      setValue("timeZone", u.workSchedule.timeZone);
                    }
                  }}
                  disabled={isEditing}
                >
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u._id} value={u._id}>{u.name} — {u.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.user && <p className="text-xs text-destructive">{errors.user.message}</p>}
          </div>

          {/* Date + Timezone */}
          <div className="space-y-1.5">
            <Label htmlFor="date">Date *</Label>
            <Input id="date" type="date" {...register("date")} />
            {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}
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

          {/* Check-in / Check-out */}
          <div className="space-y-1.5">
            <Label htmlFor="checkIn">Login (Check-in)</Label>
            <Input id="checkIn" type="datetime-local" {...register("checkIn")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="checkOut">Logout (Check-out)</Label>
            <Input id="checkOut" type="datetime-local" {...register("checkOut")} />
          </div>

          {/* Status + Late */}
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Controller
              name="status"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ATTENDANCE_STATUS_LABELS) as AttendanceStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>{ATTENDANCE_STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lateMinutes">Late (minutes)</Label>
            <Input id="lateMinutes" type="number" min={0} {...register("lateMinutes")} />
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="note">Note</Label>
            <Input id="note" placeholder="Optional note" {...register("note")} />
          </div>

          <ResponsiveDialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Record"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
