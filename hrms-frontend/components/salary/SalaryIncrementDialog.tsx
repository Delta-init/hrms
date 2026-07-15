"use client";
import { useEffect, useMemo } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, TrendingUp } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { salaryIncrementFormSchema, type SalaryIncrementFormValues } from "@/lib/validations/salaryIncrementSchema";
import { useCreateSalaryIncrement, useUpdateSalaryIncrement } from "@/hooks/useSalaryIncrements";
import { useEmployees } from "@/hooks/useEmployees";
import { cn } from "@/lib/utils";
import type { SalaryIncrement } from "@/types";

interface LockedEmployee { _id: string; name: string; employeeCode?: string; salary?: number; currency?: string }
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  increment?: SalaryIncrement | null;
  employee?: LockedEmployee | null;
}

const thisMonth = () => new Date().toISOString().slice(0, 7);
const idOf = (v: unknown) => (v && typeof v === "object" ? (v as { _id: string })._id : (v as string) || "");

export function SalaryIncrementDialog({ open, onOpenChange, increment, employee: locked }: Props) {
  const isEditing = !!increment;
  const { data: empData } = useEmployees({ limit: "200" }, { enabled: !locked && !isEditing });
  const employees = (empData?.data ?? []).filter((e) => e.status !== "terminated");
  const { mutate: create, isPending: creating } = useCreateSalaryIncrement();
  const { mutate: update, isPending: updating } = useUpdateSalaryIncrement();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, watch, formState: { errors } } = useForm<SalaryIncrementFormValues>({
    resolver: zodResolver(salaryIncrementFormSchema),
    defaultValues: { employee: locked?._id ?? "", newSalary: 0, effectiveMonth: thisMonth(), reason: "" },
  });

  useEffect(() => {
    if (!open) return;
    if (increment) {
      reset({ employee: idOf(increment.employee), newSalary: increment.newSalary, effectiveMonth: increment.effectiveMonth, reason: increment.reason ?? "" });
    } else {
      reset({ employee: locked?._id ?? "", newSalary: 0, effectiveMonth: thisMonth(), reason: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, increment, locked?._id]);

  const selectedId = watch("employee");
  const newSalary = Number(watch("newSalary")) || 0;

  const { current, currency } = useMemo(() => {
    if (locked) return { current: locked.salary ?? 0, currency: locked.currency ?? "AED" };
    if (isEditing) return { current: increment!.previousSalary, currency: (typeof increment!.employee === "object" ? increment!.employee?.currency : "") || "AED" };
    const emp = employees.find((e) => e._id === selectedId);
    return { current: emp?.salary ?? 0, currency: emp?.currency ?? "AED" };
  }, [locked, isEditing, increment, employees, selectedId]);

  const diff = newSalary - current;
  const pct = current > 0 ? (diff / current) * 100 : 0;
  const money = (n: number) => `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  const onSubmit = (data: SalaryIncrementFormValues) => {
    const payload = { ...data, reason: data.reason || undefined };
    if (isEditing) update({ id: increment._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  const lockName = locked?.name ?? (typeof increment?.employee === "object" ? increment?.employee?.name : "");
  const lockCode = locked?.employeeCode ?? (typeof increment?.employee === "object" ? increment?.employee?.employeeCode : "");

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Salary Increment" : "New Salary Increment"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Employee *</Label>
            {locked || isEditing ? (
              <div className="flex items-center rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">{lockName}{lockCode ? ` (${lockCode})` : ""}</div>
            ) : (
              <Controller name="employee" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>{employees.map((e) => <SelectItem key={e._id} value={e._id}>{e.name} ({e.employeeCode})</SelectItem>)}</SelectContent>
                </Select>
              )} />
            )}
            {errors.employee && <p className="text-xs text-destructive">{errors.employee.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="newSalary">New salary *</Label>
              <Input id="newSalary" type="number" min="0" step="0.01" {...register("newSalary")} />
              {errors.newSalary && <p className="text-xs text-destructive">{errors.newSalary.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="effectiveMonth">Effective from *</Label>
              <Input id="effectiveMonth" type="month" {...register("effectiveMonth")} />
              <p className="text-[11px] text-muted-foreground">Payroll uses it from this month.</p>
              {errors.effectiveMonth && <p className="text-xs text-destructive">{errors.effectiveMonth.message}</p>}
            </div>
          </div>

          {/* Before → after preview */}
          <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 p-3 text-sm">
            <div><p className="text-[11px] uppercase tracking-wide text-muted-foreground">Current</p><p className="font-medium">{money(current)}</p></div>
            <TrendingUp className={cn("h-5 w-5", diff >= 0 ? "text-emerald-600" : "text-red-500")} />
            <div className="text-right"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">New</p><p className="font-medium">{money(newSalary)}</p></div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Change</p>
              <p className={cn("font-semibold", diff >= 0 ? "text-emerald-600" : "text-red-500")}>{diff >= 0 ? "+" : ""}{money(diff)} {current > 0 ? `(${diff >= 0 ? "+" : ""}${pct.toFixed(1)}%)` : ""}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" rows={2} placeholder="e.g. Annual review, promotion" {...register("reason")} />
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isEditing ? "Save Changes" : "Record"}</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
