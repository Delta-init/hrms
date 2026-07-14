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
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { resignationFormSchema, type ResignationFormValues } from "@/lib/validations/resignationSchema";
import { useCreateResignation } from "@/hooks/useResignations";
import { useEmployees } from "@/hooks/useEmployees";
import { RESIGNATION_TYPE_LABELS, type ResignationType } from "@/types";

interface LockedEmployee {
  _id: string;
  name: string;
  employeeCode?: string;
  noticePeriodDays?: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the employee is preselected and locked (used from the profile tab). */
  employee?: LockedEmployee | null;
}

const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays = (dateStr: string, days: number) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  d.setDate(d.getDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
};

export function ResignationDialog({ open, onOpenChange, employee: locked }: Props) {
  const { data: empData } = useEmployees({ limit: "200" }, { enabled: !locked });
  const employees = (empData?.data ?? []).filter((e) => e.status !== "terminated");
  const { mutate: create, isPending } = useCreateResignation();

  const defaults = (): ResignationFormValues => {
    const notice = locked?.noticePeriodDays ?? 60;
    return {
      employee: locked?._id ?? "",
      resignationType: "resignation",
      resignationDate: todayStr(),
      noticeRequired: true,
      noticePeriodDays: notice,
      lastWorkingDay: addDays(todayStr(), notice),
      reason: "",
    };
  };

  const { register, handleSubmit, control, reset, watch, setValue, formState: { errors } } = useForm<ResignationFormValues>({
    resolver: zodResolver(resignationFormSchema),
    defaultValues: defaults(),
  });

  useEffect(() => {
    if (open) reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, locked?._id]);

  const resignationDate = watch("resignationDate");
  const noticePeriodDays = watch("noticePeriodDays");
  const noticeRequired = watch("noticeRequired");

  // Recompute last working day when notice settings change.
  useEffect(() => {
    setValue("lastWorkingDay", noticeRequired ? addDays(resignationDate, Number(noticePeriodDays)) : resignationDate);
  }, [resignationDate, noticePeriodDays, noticeRequired, setValue]);

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
            {locked ? (
              <div className="flex items-center rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">
                {locked.name}{locked.employeeCode ? ` (${locked.employeeCode})` : ""}
              </div>
            ) : (
              <Controller name="employee" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => onEmployeeChange(v, field.onChange)}>
                  <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                  <SelectContent>{employees.map((e) => <SelectItem key={e._id} value={e._id}>{e.name} ({e.employeeCode})</SelectItem>)}</SelectContent>
                </Select>
              )} />
            )}
            {errors.employee && <p className="text-xs text-destructive">{errors.employee.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Resigning type *</Label>
              <Controller name="resignationType" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(RESIGNATION_TYPE_LABELS) as ResignationType[]).map((t) => (
                      <SelectItem key={t} value={t}>{RESIGNATION_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="resignationDate">Submitted on *</Label>
              <Input id="resignationDate" type="date" {...register("resignationDate")} />
              {errors.resignationDate && <p className="text-xs text-destructive">{errors.resignationDate.message}</p>}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border p-3">
            <div>
              <p className="text-sm font-medium">Notice period required</p>
              <p className="text-[11px] text-muted-foreground">Turn off for an immediate exit (last working day = submitted date).</p>
            </div>
            <Controller name="noticeRequired" control={control} render={({ field }) => (
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            )} />
          </div>

          {noticeRequired && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="noticePeriodDays">Notice period (days) *</Label>
                <Input id="noticePeriodDays" type="number" min="0" {...register("noticePeriodDays")} />
                {errors.noticePeriodDays && <p className="text-xs text-destructive">{errors.noticePeriodDays.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastWorkingDay">Last working day *</Label>
                <Input id="lastWorkingDay" type="date" {...register("lastWorkingDay")} />
                {errors.lastWorkingDay && <p className="text-xs text-destructive">{errors.lastWorkingDay.message}</p>}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason for leaving</Label>
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
