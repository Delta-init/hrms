"use client";
import { useEffect, useState } from "react";
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
/**
 * The two work-mode targets, encoded into the same field as the schedules.
 *
 * Prefixed so a mode can never be mistaken for a schedule id, and so adding a
 * third kind of target later does not need a second dropdown.
 */
const MODE_OFFICE = "mode:office";
const MODE_WFH = "mode:wfh";

/** Split the single form value back into what the API stores. */
function splitTarget(target: string): { workSchedule: string | null; workMode: "office" | "wfh" | null } {
  if (target === MODE_OFFICE) return { workSchedule: null, workMode: "office" };
  if (target === MODE_WFH) return { workSchedule: null, workMode: "wfh" };
  return { workSchedule: target || null, workMode: null };
}
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
  type: "annual", label: "", target: ORG_WIDE, days: 0,
  period: "year", paid: true, eligibleAfterMonths: 0, carryForwardLimit: 0,
  minNoticeDays: 0, noticeThresholdDays: 0,
};

/** Waiting periods people actually write down, in months. */
const ELIGIBILITY_CHOICES = [
  { months: 0, label: "From day one" },
  { months: 1, label: "After 1 month" },
  { months: 3, label: "After 3 months" },
  { months: 6, label: "After 6 months" },
  { months: 12, label: "After 1 year" },
  { months: 24, label: "After 2 years" },
];
/** Anything the presets don't cover — 45 days' notice, 18 months, and so on. */
const CUSTOM_MONTHS = "__custom__";

/** "3 months" / "1 year" / "18 months" — whole years read better as years. */
function monthsLabel(months: number): string {
  if (months >= 12 && months % 12 === 0) {
    const y = months / 12;
    return `${y} year${y === 1 ? "" : "s"}`;
  }
  return `${months} month${months === 1 ? "" : "s"}`;
}

/** The single form value for a policy already saved. */
const targetOf = (p: LeavePolicy): string => {
  if (p.workMode) return p.workMode === "wfh" ? MODE_WFH : MODE_OFFICE;
  if (!p.workSchedule) return ORG_WIDE;
  return typeof p.workSchedule === "string" ? p.workSchedule : p.workSchedule._id;
};

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
  const selectedTarget = watch("target");
  const period = watch("period");
  const eligibleAfterMonths = Number(watch("eligibleAfterMonths") ?? 0);
  const minNoticeDays = Number(watch("minNoticeDays") ?? 0);
  const noticeThresholdDays = Number(watch("noticeThresholdDays") ?? 0);
  // A value the presets don't offer keeps the custom inputs open, so editing a
  // policy set to 18 months doesn't silently snap it to the nearest preset.
  const isPreset = ELIGIBILITY_CHOICES.some((c) => c.months === eligibleAfterMonths);
  const [customEligibility, setCustomEligibility] = useState(false);
  const [customUnit, setCustomUnit] = useState<"months" | "years">("months");
  const showCustom = customEligibility || !isPreset;
  const customValue = customUnit === "years" ? eligibleAfterMonths / 12 : eligibleAfterMonths;
  const isCustom = !BUILTIN_LEAVE_TYPES.includes(currentType as never);

  // A type is free if nothing covers it on the target being edited — the same
  // type can have one policy per schedule, one per kind of staff, and one
  // organization-wide.
  const takenHere = new Set(
    policies.filter((p) => targetOf(p) === (selectedTarget ?? ORG_WIDE) && p._id !== policy?._id).map((p) => p.type)
  );
  const availableTypes = BUILTIN_LEAVE_TYPES.filter((t) => !takenHere.has(t));

  useEffect(() => {
    if (!open) return;
    if (policy) {
      reset({
        type: policy.type, label: policy.label ?? "", target: targetOf(policy),
        days: policy.days, period: policy.period, paid: policy.paid,
        eligibleAfterMonths: policy.eligibleAfterMonths, carryForwardLimit: policy.carryForwardLimit,
        minNoticeDays: policy.minNoticeDays ?? 0, noticeThresholdDays: policy.noticeThresholdDays ?? 0,
      });
    } else {
      reset({ ...EMPTY, type: availableTypes[0] ?? CUSTOM });
    }
    // availableTypes is derived from the target the user may still change,
    // so it deliberately does not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, policy, reset]);

  // Changing the target can retire the chosen type if that pair is taken.
  useEffect(() => {
    if (!open || isEditing || isCustom) return;
    if (!availableTypes.includes(currentType as never) && availableTypes.length) setValue("type", availableTypes[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEditing, isCustom, selectedTarget, currentType]);

  // Reopen on the unit the saved value reads best in.
  useEffect(() => {
    if (!open) return;
    const m = Number(policy?.eligibleAfterMonths ?? 0);
    setCustomUnit(m > 0 && m % 12 === 0 ? "years" : "months");
    setCustomEligibility(false);
  }, [open, policy]);

  // A month is granted whole and never rolls over.
  useEffect(() => {
    if (period === "month") setValue("carryForwardLimit", 0);
  }, [period, setValue]);

  const onSubmit = (data: LeavePolicyFormValues) => {
    const { target, ...rest } = data;
    const payload = {
      ...rest,
      // One field on the form, two on the record — "" is the org-wide option,
      // which the server stores as neither a schedule nor a work mode.
      ...splitTarget(target),
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
            <Controller name="target" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue placeholder="All employees" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ORG_WIDE}>All employees</SelectItem>
                  {/* Grouped ahead of the schedules: office and remote cut
                      across them, and a schedule list they were mixed into
                      would read as though they were more of the same thing. */}
                  <SelectItem value={MODE_OFFICE}>All office staff</SelectItem>
                  <SelectItem value={MODE_WFH}>All work-from-home staff</SelectItem>
                  {schedules.map((w) => <SelectItem key={w._id} value={w._id}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
            <p className="text-[11px] text-muted-foreground">
              {selectedTarget === MODE_OFFICE || selectedTarget === MODE_WFH
                ? `Every ${selectedTarget === MODE_WFH ? "work-from-home" : "office"} employee, whatever work schedule they are on. This overrides both a work-schedule policy and the organization-wide one for the same type.`
                : selectedTarget
                  ? "Only employees on this work schedule get this leave. It overrides the organization-wide policy for the same type, but an office or work-from-home policy overrides it in turn."
                  : "Everyone in the organization, unless a more specific policy covers them for this type."}
            </p>
            {/* Said once, where the decision is made: entitlement is granted
                whole rather than accrued, so a cut cannot be applied to a year
                already granted and spent against. */}
            {!isEditing && (
              <p className="text-[11px] text-muted-foreground">
                Takes effect from today. Anyone already granted a larger allowance for the current period keeps it
                until the next one.
              </p>
            )}
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

          <div className="space-y-1.5">
            <Label>Eligible</Label>
            <Controller name="eligibleAfterMonths" control={control} render={({ field }) => (
              <>
                <Select
                  value={showCustom ? CUSTOM_MONTHS : String(field.value ?? 0)}
                  onValueChange={(v) => {
                    if (v === CUSTOM_MONTHS) { setCustomEligibility(true); return; }
                    setCustomEligibility(false);
                    field.onChange(Number(v));
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ELIGIBILITY_CHOICES.map((c) => (
                      <SelectItem key={c.months} value={String(c.months)}>{c.label}</SelectItem>
                    ))}
                    <SelectItem value={CUSTOM_MONTHS}>Custom…</SelectItem>
                  </SelectContent>
                </Select>

                {showCustom && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Input
                      type="number" min="0" step="1" aria-label="Waiting period"
                      value={Number.isFinite(customValue) ? customValue : 0}
                      onChange={(e) => {
                        const n = Math.max(0, Number(e.target.value) || 0);
                        field.onChange(customUnit === "years" ? n * 12 : n);
                      }}
                    />
                    <Select
                      value={customUnit}
                      onValueChange={(u) => {
                        const unit = u as "months" | "years";
                        setCustomUnit(unit);
                        // Keep the number the person typed, reinterpreted.
                        const shown = customUnit === "years" ? eligibleAfterMonths / 12 : eligibleAfterMonths;
                        field.onChange(unit === "years" ? shown * 12 : shown);
                      }}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="months">Months</SelectItem>
                        <SelectItem value="years">Years</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )} />
            <p className="text-[11px] text-muted-foreground">
              {eligibleAfterMonths > 0
                ? `Nobody can take this leave until they have served ${monthsLabel(eligibleAfterMonths)}, counted from their joining date.`
                : "Available from an employee's first day."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Advance notice</Label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="noticeThresholdDays" className="text-[11px] font-normal text-muted-foreground">
                  For requests longer than (days)
                </Label>
                <Input id="noticeThresholdDays" type="number" min="0" step="1" {...register("noticeThresholdDays")} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="minNoticeDays" className="text-[11px] font-normal text-muted-foreground">
                  Notice required (days)
                </Label>
                <Input id="minNoticeDays" type="number" min="0" step="1" {...register("minNoticeDays")} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {minNoticeDays > 0
                ? `A request longer than ${noticeThresholdDays} day${noticeThresholdDays === 1 ? "" : "s"} must be raised at least ${minNoticeDays} day${minNoticeDays === 1 ? "" : "s"} before it starts.`
                : "0 = no advance notice required, whatever the request's length."}
            </p>
          </div>

          {/* Carry-forward only means anything across a year. */}
          {period === "year" && (
            <div className="space-y-1.5">
              <Label htmlFor="carryForwardLimit">Carry-forward limit (days)</Label>
              <Input id="carryForwardLimit" type="number" min="0" step="0.5" {...register("carryForwardLimit")} />
              <p className="text-[11px] text-muted-foreground">Max unused days that roll into next year. 0 = no carry-forward.</p>
            </div>
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
