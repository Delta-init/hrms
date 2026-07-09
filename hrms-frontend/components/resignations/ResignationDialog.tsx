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
import { resignationFormSchema, type ResignationFormValues } from "@/lib/validations/resignationSchema";
import { useCreateResignation } from "@/hooks/useResignations";
import { useEmployees } from "@/hooks/useEmployees";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays = (dateStr: string, days: number) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  d.setDate(d.getDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
};

export function ResignationDialog({ open, onOpenChange }: Props) {
  const { data: empData } = useEmployees({ limit: "200" });
  const employees = (empData?.data ?? []).filter((e) => e.status !== "terminated");
  const { mutate: create, isPending } = useCreateResignation();

  const { register, handleSubmit, control, reset, watch, setValue, formState: { errors } } = useForm<ResignationFormValues>({
    resolver: zodResolver(resignationFormSchema),
    defaultValues: { employee: "", resignationDate: todayStr(), noticePeriodDays: 60, lastWorkingDay: addDays(todayStr(), 60), reason: "" },
  });

  useEffect(() => {
    if (open) reset({ employee: "", resignationDate: todayStr(), noticePeriodDays: 60, lastWorkingDay: addDays(todayStr(), 60), reason: "" });
  }, [open, reset]);

  const resignationDate = watch("resignationDate");
  const noticePeriodDays = watch("noticePeriodDays");

  // Recompute last working day whenever resignation date or notice period changes.
  useEffect(() => {
    setValue("lastWorkingDay", addDays(resignationDate, Number(noticePeriodDays)));
  }, [resignationDate, noticePeriodDays, setValue]);

  const onEmployeeChange = (id: string, onChange: (v: string) => void) => {
    onChange(id);
    const emp = employees.find((e) => e._id === id);
    if (emp?.noticePeriodDays != null) setValue("noticePeriodDays", emp.noticePeriodDays);
  };

  const onSubmit = (data: ResignationFormValues) => {
    create({ ...data, reason: data.reason || undefined }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Record Resignation</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Employee *</Label>
            <Controller name="employee" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={(v) => onEmployeeChange(v, field.onChange)}>
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>{employees.map((e) => <SelectItem key={e._id} value={e._id}>{e.name} ({e.employeeCode})</SelectItem>)}</SelectContent>
              </Select>
            )} />
            {errors.employee && <p className="text-xs text-destructive">{errors.employee.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="resignationDate">Resignation date *</Label>
              <Input id="resignationDate" type="date" {...register("resignationDate")} />
              {errors.resignationDate && <p className="text-xs text-destructive">{errors.resignationDate.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="noticePeriodDays">Notice period (days) *</Label>
              <Input id="noticePeriodDays" type="number" min="0" {...register("noticePeriodDays")} />
              {errors.noticePeriodDays && <p className="text-xs text-destructive">{errors.noticePeriodDays.message}</p>}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lastWorkingDay">Last working day *</Label>
            <Input id="lastWorkingDay" type="date" {...register("lastWorkingDay")} />
            <p className="text-[11px] text-muted-foreground">Auto-calculated from the notice period — adjust if it&apos;s negotiated.</p>
            {errors.lastWorkingDay && <p className="text-xs text-destructive">{errors.lastWorkingDay.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Textarea id="reason" rows={2} placeholder="Optional" {...register("reason")} />
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}Record</Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
