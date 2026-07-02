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
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { holidayFormSchema, type HolidayFormValues } from "@/lib/validations/leaveSchema";
import { useCreateHoliday } from "@/hooks/useLeaves";
import { useWorkSchedulesSimple } from "@/hooks/useWorkSchedules";
import { TIME_ZONES } from "@/types";

const NONE = "__none__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HolidayDialog({ open, onOpenChange }: Props) {
  const { mutate: create, isPending } = useCreateHoliday();
  const { data: schedules = [] } = useWorkSchedulesSimple();

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<HolidayFormValues>({
    resolver: zodResolver(holidayFormSchema),
    defaultValues: { name: "", date: "", timeZone: "Asia/Dubai", type: "public", recurring: false, workSchedule: "", description: "" },
  });

  useEffect(() => {
    if (open) reset({ name: "", date: new Date().toISOString().slice(0, 10), timeZone: "Asia/Dubai", type: "public", recurring: false, workSchedule: "", description: "" });
  }, [open, reset]);

  const onSubmit = (data: HolidayFormValues) => {
    create(
      { ...data, workSchedule: data.workSchedule || null, description: data.description || undefined },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Add Holiday</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4 px-4 sm:px-0">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="name">Name *</Label>
            <Input id="name" placeholder="e.g. National Day" {...register("name")} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date">Date *</Label>
            <Input id="date" type="date" {...register("date")} />
            {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="company">Company</SelectItem>
                    <SelectItem value="optional">Optional</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Time Region</Label>
            <Controller
              name="timeZone"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIME_ZONES.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="flex items-center gap-2">
            <Controller
              name="recurring"
              control={control}
              render={({ field }) => <Switch id="recurring" checked={field.value} onCheckedChange={field.onChange} />}
            />
            <Label htmlFor="recurring">Recurring yearly</Label>
          </div>
          {/* Tag to a work schedule's leave calendar (optional) */}
          <div className="col-span-2 space-y-1.5">
            <Label>Work Schedule (calendar)</Label>
            <Controller
              name="workSchedule"
              control={control}
              render={({ field }) => (
                <Select value={field.value || NONE} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Global (all)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Global (all schedules)</SelectItem>
                    {schedules.map((s) => <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Input id="description" placeholder="Optional" {...register("description")} />
          </div>

          <ResponsiveDialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Add Holiday
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
