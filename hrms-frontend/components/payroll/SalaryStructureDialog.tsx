"use client";
import { useEffect } from "react";
import { useForm, Controller, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { structureFormSchema, type StructureFormValues } from "@/lib/validations/salaryStructureSchema";
import { useCreateStructure, useUpdateStructure } from "@/hooks/useSalaryStructures";
import { SALARY_COMPONENT_CALC_LABELS, SALARY_COMPONENT_TYPE_LABELS, type SalaryStructure, type SalaryComponentCalc, type SalaryComponentType } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  structure?: SalaryStructure | null;
}

const EMPTY: StructureFormValues = { name: "", description: "", components: [] };
const PREVIEW_BASIC = 10000;

export function SalaryStructureDialog({ open, onOpenChange, structure }: Props) {
  const isEditing = !!structure;
  const { mutate: create, isPending: creating } = useCreateStructure();
  const { mutate: update, isPending: updating } = useUpdateStructure();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<StructureFormValues>({
    resolver: zodResolver(structureFormSchema),
    defaultValues: EMPTY,
  });
  const { fields, append, remove } = useFieldArray({ control, name: "components" });
  const components = useWatch({ control, name: "components" });

  useEffect(() => {
    if (!open) return;
    if (structure) {
      reset({ name: structure.name, description: structure.description ?? "", components: structure.components ?? [] });
    } else {
      reset(EMPTY);
    }
  }, [open, structure, reset]);

  const onSubmit = (data: StructureFormValues) => {
    const payload = { ...data, description: data.description || undefined };
    if (isEditing) update({ id: structure._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  // Live preview against a sample Basic of 10,000.
  const preview = (() => {
    let earn = PREVIEW_BASIC, ded = 0;
    for (const c of components ?? []) {
      const v = c.calc === "percent" ? (PREVIEW_BASIC * (Number(c.value) || 0)) / 100 : Number(c.value) || 0;
      if (c.type === "earning") earn += v; else ded += v;
    }
    return { gross: earn, net: earn - ded };
  })();
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-2xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit Salary Structure" : "New Salary Structure"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" placeholder="e.g. Grade A / Senior Staff" {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Input id="description" placeholder="Optional" {...register("description")} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Components</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => append({ name: "", type: "earning", calc: "fixed", value: 0 })}>
                <Plus className="h-3.5 w-3.5" />Add component
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Basic pay is set per employee when you assign this structure. Add allowances (earnings) and recurring deductions on top of Basic — each a fixed amount or a percentage of Basic.</p>

            {fields.length === 0 ? (
              <div className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted-foreground">No components yet — Basic only.</div>
            ) : (
              <div className="space-y-2">
                {fields.map((f, i) => (
                  <div key={f.id} className="grid grid-cols-[1fr,7rem,7.5rem,6rem,auto] items-start gap-2 rounded-md border border-border p-2">
                    <div>
                      <Input placeholder="Name" {...register(`components.${i}.name`)} />
                      {errors.components?.[i]?.name && <p className="mt-1 text-[11px] text-destructive">{errors.components[i]?.name?.message}</p>}
                    </div>
                    <Controller name={`components.${i}.type`} control={control} render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{(Object.keys(SALARY_COMPONENT_TYPE_LABELS) as SalaryComponentType[]).map((k) => <SelectItem key={k} value={k}>{SALARY_COMPONENT_TYPE_LABELS[k]}</SelectItem>)}</SelectContent>
                      </Select>
                    )} />
                    <Controller name={`components.${i}.calc`} control={control} render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{(Object.keys(SALARY_COMPONENT_CALC_LABELS) as SalaryComponentCalc[]).map((k) => <SelectItem key={k} value={k}>{SALARY_COMPONENT_CALC_LABELS[k]}</SelectItem>)}</SelectContent>
                      </Select>
                    )} />
                    <div>
                      <Input type="number" min="0" step="0.01" {...register(`components.${i}.value`)} />
                      {errors.components?.[i]?.value && <p className="mt-1 text-[11px] text-destructive">{errors.components[i]?.value?.message}</p>}
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => remove(i)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Preview at Basic 10,000 — </span>
            <span className="font-medium text-emerald-600">Gross {fmt(preview.gross)}</span>
            <span className="text-muted-foreground"> · </span>
            <span className="font-medium text-primary">Net {fmt(preview.net)}</span>
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isEditing ? "Save Changes" : "Create"}</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
