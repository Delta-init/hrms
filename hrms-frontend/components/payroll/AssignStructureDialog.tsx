"use client";
import { useEffect, useMemo } from "react";
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
import { assignFormSchema, type AssignFormValues } from "@/lib/validations/salaryStructureSchema";
import { useAssignStructure, useUpdateAssignment, useSalaryStructures } from "@/hooks/useSalaryStructures";
import type { SalaryStructureAssignment } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignment?: SalaryStructureAssignment | null;
  defaultMonth?: string;
}

const idOf = (v: unknown) => (v && typeof v === "object" ? (v as { _id: string })._id : (v as string) || "");
const thisMonth = () => new Date().toISOString().slice(0, 7);

export function AssignStructureDialog({ open, onOpenChange, assignment, defaultMonth }: Props) {
  const isEditing = !!assignment;
  const { data: structData } = useSalaryStructures({ status: "active", limit: "200" });
  const structures = structData?.data ?? [];
  const { mutate: assign, isPending: assigning } = useAssignStructure();
  const { mutate: update, isPending: updating } = useUpdateAssignment();
  const isPending = assigning || updating;

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<AssignFormValues>({
    resolver: zodResolver(assignFormSchema),
    defaultValues: { employee: "", structure: "", basicAmount: 0, effectiveMonth: defaultMonth || thisMonth(), notes: "" },
  });

  useEffect(() => {
    if (!open) return;
    if (assignment) {
      reset({ employee: idOf(assignment.employee), structure: idOf(assignment.structure), basicAmount: assignment.basicAmount, effectiveMonth: assignment.effectiveMonth, notes: assignment.notes ?? "" });
    } else {
      reset({ employee: "", structure: "", basicAmount: 0, effectiveMonth: defaultMonth || thisMonth(), notes: "" });
    }
  }, [open, assignment, defaultMonth, reset]);

  const structureId = useWatch({ control, name: "structure" });
  const basicAmount = useWatch({ control, name: "basicAmount" });
  const selected = structures.find((s) => s._id === structureId);

  const preview = useMemo(() => {
    const basic = Number(basicAmount) || 0;
    const earnings = [{ label: "Basic", amount: basic }];
    const deductions: { label: string; amount: number }[] = [];
    for (const c of selected?.components ?? []) {
      const v = c.calc === "percent" ? (basic * (Number(c.value) || 0)) / 100 : Number(c.value) || 0;
      if (c.type === "earning") earnings.push({ label: c.name, amount: v }); else deductions.push({ label: c.name, amount: v });
    }
    const gross = earnings.reduce((a, e) => a + e.amount, 0);
    const dedTotal = deductions.reduce((a, d) => a + d.amount, 0);
    return { earnings, deductions, gross, net: gross - dedTotal };
  }, [selected, basicAmount]);
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  const onSubmit = (data: AssignFormValues) => {
    const payload = { ...data, notes: data.notes || undefined };
    if (isEditing) {
      const { employee: _e, ...rest } = payload;
      update({ id: assignment._id, data: rest }, { onSuccess: () => onOpenChange(false) });
    } else {
      assign(payload, { onSuccess: () => onOpenChange(false) });
    }
  };

  const lockName = typeof assignment?.employee === "object" ? assignment?.employee?.name : "";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Assignment" : "Assign Salary Structure"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Employee *</Label>
            {isEditing ? (
              <div className="flex items-center rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">{lockName}</div>
            ) : (
              <Controller name="employee" control={control} render={({ field }) => (
                <EmployeeSelect value={field.value} onChange={field.onChange} placeholder="Select employee" />
              )} />
            )}
            {errors.employee && <p className="text-xs text-destructive">{errors.employee.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label>Structure *</Label>
            <Controller name="structure" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue placeholder="Select structure" /></SelectTrigger>
                <SelectContent>{structures.map((s) => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            )} />
            {errors.structure && <p className="text-xs text-destructive">{errors.structure.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="basicAmount">Basic amount *</Label>
              <Input id="basicAmount" type="number" min="0" step="0.01" {...register("basicAmount")} />
              {errors.basicAmount && <p className="text-xs text-destructive">{errors.basicAmount.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="effectiveMonth">Effective month *</Label>
              <Input id="effectiveMonth" type="month" {...register("effectiveMonth")} />
              {errors.effectiveMonth && <p className="text-xs text-destructive">{errors.effectiveMonth.message}</p>}
            </div>
          </div>

          {selected && (
            <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Breakup preview</p>
              {preview.earnings.map((e, i) => (
                <div key={`e${i}`} className="flex justify-between"><span>{e.label}</span><span className="tabular-nums text-emerald-600">+{fmt(e.amount)}</span></div>
              ))}
              {preview.deductions.map((d, i) => (
                <div key={`d${i}`} className="flex justify-between"><span>{d.label}</span><span className="tabular-nums text-red-500">−{fmt(d.amount)}</span></div>
              ))}
              <div className="mt-1 flex justify-between border-t border-border pt-1 font-medium">
                <span>Gross {fmt(preview.gross)}</span><span className="tabular-nums text-primary">Net {fmt(preview.net)}</span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" rows={2} placeholder="Optional (e.g. reason for revision)" {...register("notes")} />
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isEditing ? "Save Changes" : "Assign"}</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
