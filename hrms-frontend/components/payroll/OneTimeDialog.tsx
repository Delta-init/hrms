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
import { oneTimeFormSchema, type OneTimeFormValues } from "@/lib/validations/oneTimeSchema";
import { useCreateOneTime, useUpdateOneTime } from "@/hooks/useOneTimeAdjustments";
import { useEmployees } from "@/hooks/useEmployees";
import { ONE_TIME_KIND_LABELS, type OneTimeAdjustment, type OneTimeKind } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adjustment?: OneTimeAdjustment | null;
  defaultMonth?: string;
}

const idOf = (v: unknown) => (v && typeof v === "object" ? (v as { _id: string })._id : (v as string) || "");
const thisMonth = () => new Date().toISOString().slice(0, 7);

export function OneTimeDialog({ open, onOpenChange, adjustment, defaultMonth }: Props) {
  const isEditing = !!adjustment;
  const { data: empData } = useEmployees({ limit: "200" }, { enabled: !isEditing });
  const employees = (empData?.data ?? []).filter((e) => e.status !== "terminated");
  const { mutate: create, isPending: creating } = useCreateOneTime();
  const { mutate: update, isPending: updating } = useUpdateOneTime();
  const isPending = creating || updating;

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<OneTimeFormValues>({
    resolver: zodResolver(oneTimeFormSchema),
    defaultValues: { employee: "", kind: "payment", label: "", amount: 0, month: defaultMonth || thisMonth(), notes: "" },
  });

  useEffect(() => {
    if (!open) return;
    if (adjustment) {
      reset({ employee: idOf(adjustment.employee), kind: adjustment.kind, label: adjustment.label, amount: adjustment.amount, month: adjustment.month, notes: adjustment.notes ?? "" });
    } else {
      reset({ employee: "", kind: "payment", label: "", amount: 0, month: defaultMonth || thisMonth(), notes: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, adjustment, defaultMonth]);

  const onSubmit = (data: OneTimeFormValues) => {
    const payload = { ...data, notes: data.notes || undefined };
    if (isEditing) update({ id: adjustment._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  const lockName = typeof adjustment?.employee === "object" ? adjustment?.employee?.name : "";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit One-time Adjustment" : "New One-time Adjustment"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Employee *</Label>
            {isEditing ? (
              <div className="flex items-center rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">{lockName}</div>
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
              <Label>Type *</Label>
              <Controller name="kind" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ONE_TIME_KIND_LABELS) as OneTimeKind[]).map((k) => <SelectItem key={k} value={k}>{ONE_TIME_KIND_LABELS[k]}</SelectItem>)}
                  </SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="month">Payout month *</Label>
              <Input id="month" type="month" {...register("month")} />
              {errors.month && <p className="text-xs text-destructive">{errors.month.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="label">Label *</Label>
              <Input id="label" placeholder="e.g. Diwali bonus / Late fine" {...register("label")} />
              {errors.label && <p className="text-xs text-destructive">{errors.label.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount">Amount *</Label>
              <Input id="amount" type="number" min="0" step="0.01" {...register("amount")} />
              {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
            </div>
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
