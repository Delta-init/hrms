"use client";
import { useEffect, useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserSelect } from "@/components/pickers";
import { regularizationFormSchema, type RegularizationFormValues } from "@/lib/validations/regularizationSchema";
import { useCreateRegularization, useUpdateRegularization, useMyRegularizationAllowance, type CreateRegularizationResult } from "@/hooks/useRegularizations";
import { useUser } from "@/hooks/useUsers";
import { useAttendancePenaltyPolicy } from "@/hooks/useAttendancePenaltyPolicy";
import { zonedInputToUtcIso, toLocalInput, toDateInput } from "@/lib/timezone";
import { REGULARIZATION_TYPE_LABELS, TIME_ZONES, type RegularizationType, type Regularization, REGULARIZATION_OUTCOMES, ATTENDANCE_STATUS_LABELS } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lockToUserId?: string;
  /** Pass a pending request to edit it instead of raising a new one. */
  record?: Regularization | null;
}

export function RegularizationDialog({ open, onOpenChange, lockToUserId, record }: Props) {
  const editing = !!record;
  const selfMode = !!lockToUserId;
  const { mutate: create, isPending: creating } = useCreateRegularization();
  const { mutate: save, isPending: saving } = useUpdateRegularization();
  const isPending = creating || saving;
  // Which status a correction proposes is an organization setting, not a
  // constant — open the form on whatever they chose.
  const { data: policy } = useAttendancePenaltyPolicy(open);
  const defaultStatus = policy?.defaultRegularizationStatus ?? "present";

  // Only meaningful for a fresh request about the caller's own month — an
  // admin picking somebody else here would otherwise be shown their own
  // allowance instead of the person they are filing for.
  const { data: allowance } = useMyRegularizationAllowance(open && selfMode && !editing);
  const blocked = selfMode && !editing && !!allowance?.blocked;
  // Replaces the form once a fresh request goes through, so "who did this
  // reach" is something the person sees, not something they have to trust.
  const [justSubmitted, setJustSubmitted] = useState<CreateRegularizationResult | null>(null);

  const { register, handleSubmit, control, reset, setValue, watch, formState: { errors, touchedFields } } = useForm<RegularizationFormValues>({
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

  // Read through a ref so a late-arriving policy doesn't re-run the reset and
  // wipe whatever has been typed in the meantime.
  const defaultStatusRef = useRef(defaultStatus);
  defaultStatusRef.current = defaultStatus;

  useEffect(() => {
    if (!open) return;
    setJustSubmitted(null);
    if (record) {
      const tz = record.timeZone || "Asia/Dubai";
      reset({
        user: typeof record.user === "object" ? record.user._id : String(record.user ?? ""),
        date: toDateInput(record.date, tz),
        timeZone: tz,
        type: record.type,
        resultingStatus: record.resultingStatus ?? "present",
        requestedCheckIn: toLocalInput(record.requestedCheckIn, tz),
        requestedCheckOut: toLocalInput(record.requestedCheckOut, tz),
        reason: record.reason ?? "",
      });
      return;
    }
    reset({ user: lockToUserId ?? "", date: new Date().toISOString().slice(0, 10), timeZone: "Asia/Dubai", type: "missing_checkout", resultingStatus: defaultStatusRef.current, requestedCheckIn: "", requestedCheckOut: "", reason: "" });
  }, [open, reset, lockToUserId, record]);

  // If it arrives after the form opened, move only that field, and only while
  // nobody has picked a status of their own. Never on an edit — that form
  // already carries the status the request was saved with.
  useEffect(() => {
    if (open && !editing && !touchedFields.resultingStatus) setValue("resultingStatus", defaultStatus);
  }, [open, editing, defaultStatus, setValue, touchedFields.resultingStatus]);

  const resultingStatus = watch("resultingStatus");

  const onSubmit = (data: RegularizationFormValues) => {
    if (blocked) return;
    const payload: Record<string, unknown> = {
      date: data.date,
      timeZone: data.timeZone,
      type: data.type,
      resultingStatus: data.resultingStatus,
      requestedCheckIn: zonedInputToUtcIso(data.requestedCheckIn, data.timeZone),
      requestedCheckOut: zonedInputToUtcIso(data.requestedCheckOut, data.timeZone),
      reason: data.reason || undefined,
    };
    // Who the request belongs to is fixed once raised — an edit never moves it
    // to a different person.
    if (record) save({ id: record._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create({ ...payload, user: lockToUserId ?? data.user }, { onSuccess: (res) => setJustSubmitted(res) });
  };

  if (justSubmitted) {
    return (
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent desktopClassName="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Request submitted</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>Here&apos;s who was told about it.</ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-2 px-4 pb-2 sm:px-0">
            <MailedRow ok={justSubmitted.mailedDepartmentHead} label="Department head / reporting manager" />
            <MailedRow ok={justSubmitted.mailedHr} label="HR" />
            {!justSubmitted.mailedDepartmentHead && (
              <p className="text-xs text-muted-foreground">No department head or reporting manager is set for you, so nobody was mailed on that side.</p>
            )}
          </div>
          <ResponsiveDialogFooter>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    );
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{editing ? "Edit Regularization Request" : "Regularization Request"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4 px-4 sm:px-0">
          {!selfMode && !editing && (
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

          {blocked && (
            <p className="col-span-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
              You have used all {allowance?.limit} corrections for this month. It resets next month.
            </p>
          )}

          <ResponsiveDialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || blocked}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save Changes" : blocked ? "Limit reached" : "Submit Request"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function MailedRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
      {ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <XCircle className="h-4 w-4 shrink-0 text-muted-foreground" />}
      <span className={ok ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className="ml-auto text-xs text-muted-foreground">{ok ? "Mailed" : "Not mailed"}</span>
    </div>
  );
}
