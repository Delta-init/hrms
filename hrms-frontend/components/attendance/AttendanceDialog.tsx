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

/** ISO (UTC) → value for <input type="datetime-local"> as wall-clock time in `tz`,
 *  so re-opening Edit shows the same time that was originally entered (mirrors
 *  toDateInput below — using the browser's local zone here would drift the two
 *  apart, the same bug zonedInputToUtcIso fixes on the way back out). */
function toLocalInput(iso?: string | null, tz?: string): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}`;
}
/** ISO → YYYY-MM-DD in the record's own timezone, so the edit prefill matches
 *  what the list shows (avoids a silent off-by-one for zones ahead of UTC). */
function toDateInput(iso?: string | null, tz?: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/**
 * "YYYY-MM-DDTHH:mm" (a <input type="datetime-local"> value, timezone-less) → ISO UTC,
 * interpreting the wall-clock value in `timeZone` rather than the browser's local zone.
 * `new Date(localString).toISOString()` would silently use the browser's zone instead of
 * the selected Time Region, producing a check-in/out time offset from what was entered.
 */
function zonedInputToUtcIso(localDateTime: string | null | undefined, timeZone: string): string | null {
  if (!localDateTime) return null;
  const [datePart, timePart] = localDateTime.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mi] = timePart.split(":").map(Number);
  const asUTC = Date.UTC(y, m - 1, d, hh, mi);

  // Format that same instant as it would read in `timeZone`, then measure the
  // gap back to the UTC instant we started from — that gap is the zone's offset.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date(asUTC));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour24 = get("hour") % 24; // Intl can format midnight as "24"
  const asIfUtcInZone = Date.UTC(get("year"), get("month") - 1, get("day"), hour24, get("minute"), get("second"));
  const offset = asUTC - asIfUtcInZone;

  return new Date(asUTC + offset).toISOString();
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
