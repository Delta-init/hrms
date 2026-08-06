"use client";
import { useEffect } from "react";
import { useForm, Controller, useWatch } from "react-hook-form";
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
import { EmployeeSelect } from "@/components/pickers";
import { useEmployee } from "@/hooks/useEmployees";
import { overtimeFormSchema, type OvertimeFormValues } from "@/lib/validations/overtimeSchema";
import { useCreateOvertime, useUpdateOvertime } from "@/hooks/useOvertime";
import type { Overtime } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overtime?: Overtime | null;
  defaultMonth?: string;
}

const idOf = (v: unknown) => (v && typeof v === "object" ? (v as { _id: string })._id : (v as string) || "");
const thisMonth = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY: OvertimeFormValues = { employee: "", date: today(), hours: 0, hourlyRate: 0, multiplier: 1.5, month: thisMonth(), notes: "" };

export function OvertimeDialog({ open, onOpenChange, overtime, defaultMonth }: Props) {
  const isEditing = !!overtime;
  const { mutate: create, isPending: creating } = useCreateOvertime();
  const { mutate: update, isPending: updating } = useUpdateOvertime();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, setValue, formState: { errors } } = useForm<OvertimeFormValues>({
    resolver: zodResolver(overtimeFormSchema),
    defaultValues: { ...EMPTY, month: defaultMonth || thisMonth() },
  });

  useEffect(() => {
    if (!open) return;
    if (overtime) {
      reset({ employee: idOf(overtime.employee), date: overtime.date?.slice(0, 10) || today(), hours: overtime.hours, hourlyRate: overtime.hourlyRate, multiplier: overtime.multiplier, month: overtime.month, notes: overtime.notes ?? "" });
    } else {
      reset({ ...EMPTY, month: defaultMonth || thisMonth() });
    }
  }, [open, overtime, defaultMonth, reset]);

  const employeeId = useWatch({ control, name: "employee" });
  // The picker only loads a page at a time, so the chosen employee is
  // fetched by id rather than looked up in the visible list.
  const { data: pickedEmployee } = useEmployee(employeeId || undefined);
  const hours = useWatch({ control, name: "hours" });
  const hourlyRate = useWatch({ control, name: "hourlyRate" });
  const multiplier = useWatch({ control, name: "multiplier" });

  // Suggest an hourly rate from the picked employee's monthly salary (÷ ~240 hrs).
  useEffect(() => {
    if (isEditing || !employeeId) return;
    const emp = pickedEmployee;
    if (emp?.salary && (!hourlyRate || Number(hourlyRate) === 0)) setValue("hourlyRate", Math.round((emp.salary / 240) * 100) / 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId, pickedEmployee]);

  const amount = (Number(hours) || 0) * (Number(hourlyRate) || 0) * (Number(multiplier) || 1);
  const cur = pickedEmployee?.currency ?? "";

  const onSubmit = (data: OvertimeFormValues) => {
    const payload = { ...data, notes: data.notes || undefined };
    if (isEditing) { const { employee: _e, ...rest } = payload; update({ id: overtime._id, data: rest }, { onSuccess: () => onOpenChange(false) }); }
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  const lockName = typeof overtime?.employee === "object" ? overtime?.employee?.name : "";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Overtime" : "Record Overtime"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Employee *</Label>
            {isEditing ? (
              <div className="flex items-center rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">{lockName}</div>
            ) : (
              <Controller name="employee" control={control} render={({ field }) => (
                <EmployeeSelect value={field.value} onChange={field.onChange} />
              )} />
            )}
            {errors.employee && <p className="text-xs text-destructive">{errors.employee.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="date">Date worked *</Label>
              <Input id="date" type="date" {...register("date")} />
              {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="month">Payout month *</Label>
              <Input id="month" type="month" {...register("month")} />
              {errors.month && <p className="text-xs text-destructive">{errors.month.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="hours">Hours *</Label>
              <Input id="hours" type="number" min="0" step="0.5" {...register("hours")} />
              {errors.hours && <p className="text-xs text-destructive">{errors.hours.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hourlyRate">Hourly rate *</Label>
              <Input id="hourlyRate" type="number" min="0" step="0.01" {...register("hourlyRate")} />
              {errors.hourlyRate && <p className="text-xs text-destructive">{errors.hourlyRate.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="multiplier">Multiplier *</Label>
              <Input id="multiplier" type="number" min="1" step="0.25" {...register("multiplier")} />
              {errors.multiplier && <p className="text-xs text-destructive">{errors.multiplier.message}</p>}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">Hourly rate is auto-suggested from the employee&apos;s monthly salary ÷ 240 — override as needed.</p>

          <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Overtime pay</span>
            <span className="font-semibold tabular-nums text-emerald-600">{cur} {amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} placeholder="Optional" {...register("notes")} />
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isEditing ? "Save Changes" : "Add"}</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
