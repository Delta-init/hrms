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
import { WorkScheduleSelect } from "@/components/pickers";
import { holidayFormSchema, type HolidayFormValues } from "@/lib/validations/leaveSchema";
import { useCreateHoliday } from "@/hooks/useLeaves";
import { TIME_ZONES } from "@/types";

const NONE = "__none__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HolidayDialog({ open, onOpenChange }: Props) {
  const { mutate: create, isPending } = useCreateHoliday();

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<HolidayFormValues>({
    resolver: zodResolver(holidayFormSchema),
    defaultValues: { name: "", date: "", timeZone: "Asia/Dubai", type: "public", recurring: false, workSchedule: "", workMode: "", provisional: false, description: "" },
  });

  useEffect(() => {
    if (open) reset({ name: "", date: new Date().toISOString().slice(0, 10), timeZone: "Asia/Dubai", type: "public", recurring: false, workSchedule: "", workMode: "", provisional: false, description: "" });
  }, [open, reset]);

  const onSubmit = (data: HolidayFormValues) => {
    create(
      {
        ...data,
        workSchedule: data.workSchedule || null,
        // "" is the everybody option; the server stores that as no work mode,
        // which is what every holiday written before this field meant.
        workMode: data.workMode || null,
        description: data.description || undefined,
      },
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
          {/* Whose calendar this is. The most consequential field on the form:
              a holiday left as everybody's is counted by payroll, leave and the
              attendance calendar for every employee in the organisation. */}
          <div className="col-span-2 space-y-1.5">
            <Label>Applies to</Label>
            <Controller
              name="workMode"
              control={control}
              render={({ field }) => (
                <Select value={field.value || "all"} onValueChange={(v) => field.onChange(v === "all" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Everyone in the organisation</SelectItem>
                    <SelectItem value="office">Office staff only</SelectItem>
                    <SelectItem value="wfh">Work-from-home staff only</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            <p className="text-[11px] text-muted-foreground">
              A regional holiday is rarely everybody&apos;s — this decides who is paid for it, whose leave request
              skips it, and who is not expected to clock in.
            </p>
          </div>

          <div className="col-span-2 flex items-center gap-2">
            <Controller
              name="provisional"
              control={control}
              render={({ field }) => (
                <Switch id="provisional" checked={!!field.value} onCheckedChange={field.onChange} />
              )}
            />
            <Label htmlFor="provisional" className="font-normal">
              Date may move
              <span className="ml-1 text-[11px] text-muted-foreground">
                — set by moon sighting, or not yet confirmed
              </span>
            </Label>
          </div>

          {/* Tag to a work schedule's leave calendar (optional) */}
          <div className="col-span-2 space-y-1.5">
            <Label>Work Schedule (calendar)</Label>
            <Controller
              name="workSchedule"
              control={control}
              render={({ field }) => (
                <WorkScheduleSelect
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Global (all schedules)"
                  allowClear
                />
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
