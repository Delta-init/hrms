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
import { UserSelect } from "@/components/pickers";
import { attendanceFormSchema, type AttendanceFormValues } from "@/lib/validations/attendanceSchema";
import { useCreateAttendance, useUpdateAttendance } from "@/hooks/useAttendance";
import { useUser } from "@/hooks/useUsers";
import { ATTENDANCE_STATUS_LABELS, TIME_ZONES, type Attendance, type AttendanceStatus } from "@/types";
import { toLocalInput, toDateInput, zonedInputToUtcIso } from "@/lib/timezone";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attendance?: Attendance | null;
}

export function AttendanceDialog({ open, onOpenChange, attendance }: Props) {
  const isEditing = !!attendance;
  const { mutate: create, isPending: creating } = useCreateAttendance();
  const { mutate: update, isPending: updating } = useUpdateAttendance();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, setValue, watch, formState: { errors } } = useForm<AttendanceFormValues>({
    resolver: zodResolver(attendanceFormSchema),
    defaultValues: { user: "", date: "", timeZone: "Asia/Dubai", checkIn: "", checkOut: "", status: "present", lateMinutes: 0, note: "" },
  });

  // Auto-fill the time region from the picked person's work schedule, on create
  // only — an existing record keeps the zone it was filed in (see LeaveDialog).
  const selectedUserId = watch("user");
  const { data: selectedUser } = useUser(isEditing ? "" : selectedUserId || "");
  useEffect(() => {
    if (isEditing) return;
    const ws = selectedUser?.workSchedule;
    if (ws && typeof ws === "object" && ws.timeZone) setValue("timeZone", ws.timeZone);
  }, [isEditing, selectedUser, setValue]);

  useEffect(() => {
    if (!open) return;
    if (attendance) {
      reset({
        user: attendance.user && typeof attendance.user === "object" ? attendance.user._id : attendance.user,
        date: toDateInput(attendance.date, attendance.timeZone),
        timeZone: attendance.timeZone,
        checkIn: toLocalInput(attendance.checkIn, attendance.timeZone),
        checkOut: toLocalInput(attendance.checkOut, attendance.timeZone),
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
      checkIn: zonedInputToUtcIso(data.checkIn, data.timeZone || "Asia/Dubai"),
      checkOut: zonedInputToUtcIso(data.checkOut, data.timeZone || "Asia/Dubai"),
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
