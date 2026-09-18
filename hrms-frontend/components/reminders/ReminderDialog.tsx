"use client";
import { useEffect, useState } from "react";
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
import { useAuth } from "@/hooks/useAuth";
import { useCreateReminder } from "@/hooks/useReminders";
import { reminderFormSchema, type ReminderFormValues } from "@/lib/validations/reminderSchema";
import { REMINDER_AUDIENCE_LABELS, type ReminderAudience } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const todayStr = () => new Date().toISOString().slice(0, 10);
const EMPTY = (): ReminderFormValues => ({ title: "", message: "", audience: "self", date: todayStr(), time: "", timeZone: "Asia/Dubai" });

export function ReminderDialog({ open, onOpenChange }: Props) {
  const { hasPermission } = useAuth();
  const canApproveEveryone = hasPermission("reminders", "approve");
  const { mutate: create, isPending } = useCreateReminder();
  const [hasTime, setHasTime] = useState(false);

  const { register, handleSubmit, control, reset, formState: { errors } } = useForm<ReminderFormValues>({
    resolver: zodResolver(reminderFormSchema),
    defaultValues: EMPTY(),
  });

  useEffect(() => {
    if (!open) return;
    reset(EMPTY());
    setHasTime(false);
  }, [open, reset]);

  const audiences: ReminderAudience[] = canApproveEveryone ? ["self", "team", "everyone"] : ["self", "team"];

  const onSubmit = (data: ReminderFormValues) => {
    const payload = { ...data, time: hasTime && data.time ? data.time : undefined };
    create(payload, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>New Reminder</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title *</Label>
            <Input id="title" placeholder="e.g. Submit timesheets" {...register("title")} />
            {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="message">Message</Label>
            <Textarea id="message" rows={3} placeholder="Optional details" {...register("message")} />
          </div>

          <div className="space-y-1.5">
            <Label>Who should get this?</Label>
            <Controller name="audience" control={control} render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {audiences.map((a) => <SelectItem key={a} value={a}>{REMINDER_AUDIENCE_LABELS[a]}</SelectItem>)}
                </SelectContent>
              </Select>
            )} />
            <p className="text-[11px] text-muted-foreground">
              &quot;My team&quot; reaches everyone in your own department.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="date">Date *</Label>
              <Input id="date" type="date" {...register("date")} />
              {errors.date && <p className="text-xs text-destructive">{errors.date.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="time">Time</Label>
              <Input id="time" type="time" disabled={!hasTime} {...register("time")} />
              {errors.time && <p className="text-xs text-destructive">{errors.time.message}</p>}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Set a specific time</p>
              <p className="text-[11px] text-muted-foreground">
                {hasTime
                  ? "Pings 30 minutes before, 5 minutes before, and at the time itself."
                  : "Without a time, this sends one email the evening before."}
              </p>
            </div>
            <Switch checked={hasTime} onCheckedChange={setHasTime} />
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Schedule Reminder
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
