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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserSelect } from "@/components/pickers";
import { regularizationFormSchema, type RegularizationFormValues } from "@/lib/validations/regularizationSchema";
import { useCreateRegularization } from "@/hooks/useRegularizations";
import { useUser } from "@/hooks/useUsers";
import { zonedInputToUtcIso } from "@/lib/timezone";
import { REGULARIZATION_TYPE_LABELS, TIME_ZONES, type RegularizationType, REGULARIZATION_OUTCOMES, ATTENDANCE_STATUS_LABELS } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lockToUserId?: string;
}

export function RegularizationDialog({ open, onOpenChange, lockToUserId }: Props) {
  const selfMode = !!lockToUserId;
  const { mutate: create, isPending } = useCreateRegularization();

  const { register, handleSubmit, control, reset, setValue, watch, formState: { errors } } = useForm<RegularizationFormValues>({
    resolver: zodResolver(regularizationFormSchema),
    defaultValues: { user: "", date: "", timeZone: "Asia/Dubai", type: "missing_checkout", resultingStatus: "present", requestedCheckIn: "", requestedCheckOut: "", reason: "" },
  });

  // Default the time zone from the picked person's work schedule. Fetched by id
  // rather than looked up in the picker's page, which holds one page of results.
  const selectedUserId = watch("user");
  const { data: selectedUser } = useUser(selectedUserId || "");
  useEffect(() => {
    const ws = selectedUser?.workSchedule;
    if (ws && typeof ws === "object" && ws.timeZone) setValue("timeZone", ws.timeZone);
  }, [selectedUser, setValue]);

  useEffect(() => {
    if (open) reset({ user: lockToUserId ?? "", date: new Date().toISOString().slice(0, 10), timeZone: "Asia/Dubai", type: "missing_checkout", resultingStatus: "present", requestedCheckIn: "", requestedCheckOut: "", reason: "" });
  }, [open, reset, lockToUserId]);

  const resultingStatus = watch("resultingStatus");

  const onSubmit = (data: RegularizationFormValues) => {
    const payload: Record<string, unknown> = {
      user: lockToUserId ?? data.user,
      date: data.date,
      timeZone: data.timeZone,
      type: data.type,
      requestedCheckIn: zonedInputToUtcIso(data.requestedCheckIn, data.timeZone),
      requestedCheckOut: zonedInputToUtcIso(data.requestedCheckOut, data.timeZone),
      reason: data.reason || undefined,
    };
    create(payload, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Regularization Request</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4 px-4 sm:px-0">
          {!selfMode && (
            <div className="col-span-2 space-y-1.5">
              <Label>Employee *</Label>
              <Controller
                name="user"
                control={control}
                render={({ field }) => (
                  <UserSelect value={field.value} onChange={field.onChange} placeholder="Select employee" />
                )}
              />
              {errors.user && <p className="text-xs text-destructive">{errors.user.message}</p>}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="date">Date *</Label>
            <Input id="date" type="date" {...register("date")} />
            {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(REGULARIZATION_TYPE_LABELS) as RegularizationType[]).map((t) => (
                      <SelectItem key={t} value={t}>{REGULARIZATION_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Mark the day as</Label>
            <Controller
              name="resultingStatus"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REGULARIZATION_OUTCOMES.map((o) => (
                      <SelectItem key={o} value={o}>{ATTENDANCE_STATUS_LABELS[o]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="col-span-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {/* Approval overwrites the day's status outright, so it is worth
                saying which one before anybody approves it. */}
            Once approved, this day is marked{" "}
            <span className="font-medium text-foreground">{ATTENDANCE_STATUS_LABELS[resultingStatus]}</span>
            {" "}and the corrected times are applied.
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="requestedCheckIn">Correct Check-in</Label>
            <Input id="requestedCheckIn" type="datetime-local" {...register("requestedCheckIn")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="requestedCheckOut">Correct Check-out</Label>
            <Input id="requestedCheckOut" type="datetime-local" {...register("requestedCheckOut")} />
          </div>
          {errors.requestedCheckIn && (
            <p className="col-span-2 -mt-2 text-xs text-destructive">{errors.requestedCheckIn.message}</p>
          )}

          <div className="space-y-1.5">
            <Label>Time Region</Label>
            <Controller
              name="timeZone"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TIME_ZONES.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}</SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-1.5 self-end">
            {/* spacer to keep grid tidy */}
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" rows={2} placeholder="Why does this day need correcting?" {...register("reason")} />
          </div>

          <ResponsiveDialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit Request
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
