"use client";
import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { leavePolicyFormSchema, BUILTIN_LEAVE_TYPES, type LeavePolicyFormValues } from "@/lib/validations/leavePolicySchema";
import { useCreateLeavePolicy, useUpdateLeavePolicy } from "@/hooks/useLeaveBalances";
import { useWorkSchedulesSimple } from "@/hooks/useWorkSchedules";
import { LEAVE_TYPE_LABELS, type LeavePolicy, type LeavePeriod, leaveTypeLabel } from "@/types";

/** The org-wide option. Empty string, so the Select has a real value to hold. */
const ORG_WIDE = "";
/** Sentinel for "a type the built-in list doesn't cover". */
const CUSTOM = "__custom__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policy?: LeavePolicy | null;
  /** Every policy already configured, so a type can be offered per schedule. */
  policies: LeavePolicy[];
}

const EMPTY: LeavePolicyFormValues = {
  type: "annual", label: "", workSchedule: ORG_WIDE, days: 0,
  period: "year", paid: true, accrueMonthly: true, carryForwardLimit: 0,
};

const scheduleIdOf = (p: LeavePolicy) =>
  !p.workSchedule ? ORG_WIDE : typeof p.workSchedule === "string" ? p.workSchedule : p.workSchedule._id;

export function LeavePolicyDialog({ open, onOpenChange, policy, policies }: Props) {
  const isEditing = !!policy;
  const { data: schedules = [] } = useWorkSchedulesSimple();
  const { mutate: create, isPending: creating } = useCreateLeavePolicy();
  const { mutate: update, isPending: updating } = useUpdateLeavePolicy();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, watch, setValue, formState: { errors } } = useForm<LeavePolicyFormValues>({
    resolver: zodResolver(leavePolicyFormSchema),
    defaultValues: EMPTY,
  });

  const currentType = watch("type");
  const selectedSchedule = watch("workSchedule");
  const period = watch("period");
  const isCustom = !BUILTIN_LEAVE_TYPES.includes(currentType as never);

  // A type is free if nothing covers it on the schedule being edited — the same
  // type can have one policy per schedule plus an organization-wide one.
  const takenHere = new Set(
    policies.filter((p) => scheduleIdOf(p) === (selectedSchedule ?? ORG_WIDE) && p._id !== policy?._id).map((p) => p.type)
  );
  const availableTypes = BUILTIN_LEAVE_TYPES.filter((t) => !takenHere.has(t));

  useEffect(() => {
    if (!open) return;
    if (policy) {
      reset({
        type: policy.type, label: policy.label ?? "", workSchedule: scheduleIdOf(policy),
        days: policy.days, period: policy.period, paid: policy.paid,
        accrueMonthly: policy.accrueMonthly, carryForwardLimit: policy.carryForwardLimit,
      });
    } else {
      reset({ ...EMPTY, type: availableTypes[0] ?? CUSTOM });
    }
    // availableTypes is derived from the schedule the user may still change,
    // so it deliberately does not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, policy, reset]);

  // Changing the schedule can retire the chosen type if that pair is taken.
  useEffect(() => {
    if (!open || isEditing || isCustom) return;
    if (!availableTypes.includes(currentType as never) && availableTypes.length) setValue("type", availableTypes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEditing, isCustom, selectedSchedule, currentType]);

  // A month is granted whole and never rolls over.
  useEffect(() => {
    if (period === "month") setValue("carryForwardLimit", 0);
  }, [period, setValue]);

  const onSubmit = (data: LeavePolicyFormValues) => {
    const payload = {
      ...data,
      // "" is the org-wide option; the server stores that as no schedule.
      workSchedule: data.workSchedule || null,
      label: data.label?.trim() || undefined,
      carryForwardLimit: data.period === "month" ? 0 : data.carryForwardLimit,
    };
    if (isEditing) update({ id: policy._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Leave Policy" : "New Leave Policy"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Applies to</Label>
            <Controller name="workSchedule" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue placeholder="All employees" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ORG_WIDE}>All employees</SelectItem>
                  {schedules.map((w) => <SelectItem key={w._id} value={w._id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
            <p className="text-[11px] text-muted-foreground">
              {selectedSchedule
                ? "Only employees on this work schedule get this leave. It overrides any organization-wide policy for the same type."
                : "Everyone in the organization, unless their work schedule has its own policy for this type."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Leave type *</Label>
            {isEditing ? (
              <div className="flex items-center rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">
                {policy.label?.trim() || leaveTypeLabel(policy.type)}
              </div>
            ) : (
              <Select
                value={isCustom ? CUSTOM : currentType}
                onValueChange={(v) => setValue("type", v === CUSTOM ? "" : v, { shouldValidate: false })}
              >
                <SelectTrigger><SelectValue placeholder="Pick a type" /></SelectTrigger>
                <SelectContent>
                  {availableTypes.map((t) => <SelectItem key={t} value={t}>{LEAVE_TYPE_LABELS[t] ?? t}</SelectItem>)}
                  <SelectItem value={CUSTOM}>Something else…</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>

          {/* A type the built-in list doesn't cover needs both a slug and a name. */}
          {!isEditing && isCustom && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="type">Identifier *</Label>
                <Input id="type" placeholder="hajj_leave" {...register("type")} />
                {errors.type && <p className="text-xs text-destructive">{errors.type.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="label">Name *</Label>
                <Input id="label" placeholder="Hajj Leave" {...register("label")} />
                {errors.label && <p className="text-xs text-destructive">{errors.label.message}</p>}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="days">Days *</Label>
              <Input id="days" type="number" min="0" step="0.5" {...register("days")} />
              {errors.days && <p className="text-xs text-destructive">{errors.days.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Granted</Label>
              <Controller name="period" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => field.onChange(v as LeavePeriod)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Every month</SelectItem>
                    <SelectItem value="year">Every year</SelectItem>
                  </SelectContent>
                </Select>
              )} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="pr-3">
              <p className="text-sm font-medium">Paid leave</p>
              <p className="text-[11px] text-muted-foreground">
                Unpaid leave becomes Loss of Pay on the payslip. Paid leave doesn&apos;t reduce salary.
              </p>
            </div>
            <Controller name="paid" control={control} render={({ field }) => (
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            )} />
          </div>

          {/* Accrual and carry-forward only mean anything across a year. */}
          {period === "year" && (
            <>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="pr-3">
                  <p className="text-sm font-medium">Accrue monthly</p>
                  <p className="text-[11px] text-muted-foreground">Pro-rate through the year instead of granting it all upfront.</p>
                </div>
                <Controller name="accrueMonthly" control={control} render={({ field }) => (
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                )} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="carryForwardLimit">Carry-forward limit (days)</Label>
                <Input id="carryForwardLimit" type="number" min="0" step="0.5" {...register("carryForwardLimit")} />
                <p className="text-[11px] text-muted-foreground">Max unused days that roll into next year. 0 = no carry-forward.</p>
              </div>
            </>
          )}

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isEditing ? "Save Changes" : "Create Policy"}
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
