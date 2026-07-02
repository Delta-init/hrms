"use client";
import { useEffect } from "react";
import { useForm, Controller, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { payslipFormSchema, type PayslipFormValues } from "@/lib/validations/payslipSchema";
import { useCreatePayslip, useUpdatePayslip, usePayslipSummary } from "@/hooks/usePayslips";
import { useEmployees } from "@/hooks/useEmployees";
import { toast } from "@/lib/toast";
import type { Payslip } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payslip?: Payslip | null;
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

export function PayslipDialog({ open, onOpenChange, payslip }: Props) {
  const isEditing = !!payslip;
  const { data: empData } = useEmployees({ limit: "200" });
  const employees = empData?.data ?? [];
  const { mutate: create, isPending: creating } = useCreatePayslip();
  const { mutate: update, isPending: updating } = useUpdatePayslip();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, watch, setValue, formState: { errors } } = useForm<PayslipFormValues>({
    resolver: zodResolver(payslipFormSchema),
    defaultValues: { employee: "", month: thisMonth(), currency: "AED", earnings: [{ label: "Basic", amount: 0 }], deductions: [], status: "draft" },
  });
  const earnings = useFieldArray({ control, name: "earnings" });
  const deductions = useFieldArray({ control, name: "deductions" });

  const employee = watch("employee");
  const month = watch("month");
  const { data: summary } = usePayslipSummary(!isEditing ? employee : undefined, !isEditing ? month : undefined);

  useEffect(() => {
    if (!open) return;
    if (payslip) {
      reset({
        employee: typeof payslip.employee === "object" ? payslip.employee._id : payslip.employee,
        month: payslip.month, currency: payslip.currency,
        earnings: payslip.earnings.length ? payslip.earnings : [{ label: "Basic", amount: 0 }],
        deductions: payslip.deductions,
        status: payslip.status, notes: payslip.notes ?? "",
      });
    } else {
      reset({ employee: "", month: thisMonth(), currency: "AED", earnings: [{ label: "Basic", amount: 0 }], deductions: [], status: "draft" });
    }
  }, [open, payslip, reset]);

  const watchedEarnings = watch("earnings");
  const watchedDeductions = watch("deductions");
  const currency = watch("currency");
  const gross = (watchedEarnings ?? []).reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const totalDed = (watchedDeductions ?? []).reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const net = gross - totalDed;

  const prefill = () => {
    if (!summary) { toast.info("Select an employee & month first"); return; }
    if (summary.salary > 0) {
      const first = earnings.fields[0];
      if (first) setValue(`earnings.0.label`, "Basic"), setValue(`earnings.0.amount`, summary.salary);
      else earnings.append({ label: "Basic", amount: summary.salary });
    }
    if (summary.lopDays > 0 && summary.salary > 0) {
      const perDay = Math.round((summary.salary / 30) * 100) / 100;
      const lop = Math.round(perDay * summary.lopDays * 100) / 100;
      deductions.append({ label: `Loss of Pay (${summary.lopDays}d)`, amount: lop });
    }
    toast.success("Prefilled from attendance");
  };

  const onSubmit = (data: PayslipFormValues) => {
    const payload = { ...data, notes: data.notes || undefined };
    if (isEditing) update({ id: payslip._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  const money = (n: number) => `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const lineRows = (
    fa: { fields: { id: string }[]; append: (v: { label: string; amount: number }) => void; remove: (i: number) => void },
    name: "earnings" | "deductions",
    addLabel: string,
  ) => (
    <div className="space-y-2">
      {fa.fields.map((f, i) => (
        <div key={f.id} className="flex items-center gap-2">
          <Input placeholder="Label" className="flex-1" {...register(`${name}.${i}.label` as const)} />
          <Input type="number" step="0.01" placeholder="0.00" className="w-32" {...register(`${name}.${i}.amount` as const)} />
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => fa.remove(i)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fa.append({ label: "", amount: 0 })}><Plus className="h-3.5 w-3.5" />{addLabel}</Button>
    </div>
  );

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Payslip" : "Generate Payslip"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 px-4 sm:px-0">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label>Employee *</Label>
              <Controller name="employee" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={isEditing}>
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>{employees.map((e) => <SelectItem key={e._id} value={e._id}>{e.name} ({e.employeeCode})</SelectItem>)}</SelectContent>
                </Select>
              )} />
              {errors.employee && <p className="text-xs text-destructive">{errors.employee.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="month">Month *</Label>
              <Input id="month" type="month" {...register("month")} />
              {errors.month && <p className="text-xs text-destructive">{errors.month.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" className="uppercase" {...register("currency")} />
            </div>
          </div>

          {!isEditing && (
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={prefill}>
              <Wand2 className="h-3.5 w-3.5" />Prefill from attendance {summary && summary.lopDays > 0 ? `(LOP ${summary.lopDays}d)` : ""}
            </Button>
          )}

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-emerald-600">Earnings</Label>
              {lineRows(earnings, "earnings", "Add earning")}
            </div>
            <div className="space-y-2">
              <Label className="text-red-600">Deductions</Label>
              {lineRows(deductions, "deductions", "Add deduction")}
            </div>
          </div>

          {/* Totals */}
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Gross</span><span className="font-medium text-emerald-600">{money(gross)}</span></div>
            <div className="mt-1 flex items-center justify-between text-sm"><span className="text-muted-foreground">Deductions</span><span className="font-medium text-red-600">− {money(totalDed)}</span></div>
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-base font-bold"><span>Net Pay</span><span className="text-primary">{money(net)}</span></div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Controller name="status" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="issued">Issued</SelectItem><SelectItem value="paid">Paid</SelectItem></SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" placeholder="Optional" {...register("notes")} />
            </div>
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isEditing ? "Save Changes" : "Generate"}</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
