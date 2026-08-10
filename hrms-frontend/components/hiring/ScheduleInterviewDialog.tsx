"use client";
import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { Loader2, AlertTriangle } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useScheduleInterview, usePanelConflicts } from "@/hooks/useInterviews";
import { useUsers } from "@/hooks/useUsers";
import { cn } from "@/lib/utils";
import { INTERVIEW_MODE_LABELS, type InterviewMode } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicationId: string;
  candidateName?: string;
  /** Next round number, so a second interview does not have to be numbered by hand. */
  nextRound: number;
}

interface FormValues {
  round: number;
  mode: InterviewMode;
  date: string;
  time: string;
  durationMinutes: number;
  location: string;
  meetingLink: string;
  notes: string;
}

/** A local date and time as an instant. The browser's zone is the one the
 *  person filling this in is thinking in. */
const toIso = (date: string, time: string) => (date && time ? new Date(`${date}T${time}`).toISOString() : "");

export function ScheduleInterviewDialog({ open, onOpenChange, applicationId, candidateName, nextRound }: Props) {
  const { mutate: schedule, isPending } = useScheduleInterview();
  const { data: userData } = useUsers({ limit: "100" });
  const users = userData?.data ?? [];
  const [panel, setPanel] = useState<string[]>([]);

  const { register, handleSubmit, control, reset, watch, formState: { errors } } = useForm<FormValues>({
    defaultValues: { round: nextRound, mode: "video", date: "", time: "10:00", durationMinutes: 60, location: "", meetingLink: "", notes: "" },
  });

  const mode = watch("mode");
  const date = watch("date");
  const time = watch("time");
  const duration = Number(watch("durationMinutes")) || 60;
  const scheduledAt = toIso(date, time);

  // Advisory only: this can see interviews this system scheduled and nothing
  // else, so it warns rather than blocking a slot somebody knows is free.
  const { data: conflicts = [] } = usePanelConflicts(panel, scheduledAt, duration);

  useEffect(() => {
    if (open) {
      reset({ round: nextRound, mode: "video", date: "", time: "10:00", durationMinutes: 60, location: "", meetingLink: "", notes: "" });
      setPanel([]);
    }
  }, [open, nextRound, reset]);

  const toggle = (id: string) => setPanel((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const onSubmit = (d: FormValues) => {
    schedule(
      {
        application: applicationId,
        round: Number(d.round) || 1,
        mode: d.mode,
        scheduledAt: toIso(d.date, d.time),
        durationMinutes: Number(d.durationMinutes) || 60,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        location: d.mode === "in_person" ? d.location : undefined,
        meetingLink: d.mode === "video" ? d.meetingLink : undefined,
        panel,
        notes: d.notes || undefined,
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Schedule an interview{candidateName ? ` — ${candidateName}` : ""}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-4 sm:px-0">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="round">Round</Label>
              <Input id="round" type="number" min={1} {...register("round")} />
            </div>
            <div className="space-y-1.5">
              <Label>How</Label>
              <Controller name="mode" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(INTERVIEW_MODE_LABELS) as InterviewMode[]).map((m) => (
                      <SelectItem key={m} value={m}>{INTERVIEW_MODE_LABELS[m]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="date">Date *</Label>
              <Input id="date" type="date" {...register("date", { required: true })} />
              {errors.date && <p className="text-xs text-destructive">Pick a date</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="time">Time *</Label>
              <Input id="time" type="time" {...register("time", { required: true })} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="durationMinutes">Minutes</Label>
              <Input id="durationMinutes" type="number" min={5} step={5} {...register("durationMinutes")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              {mode === "in_person" ? (
                <>
                  <Label htmlFor="location">Where *</Label>
                  <Input id="location" placeholder="Meeting room, office…" {...register("location")} />
                </>
              ) : mode === "video" ? (
                <>
                  <Label htmlFor="meetingLink">Meeting link *</Label>
                  <Input id="meetingLink" type="url" placeholder="https://…" {...register("meetingLink")} />
                </>
              ) : (
                <>
                  <Label htmlFor="location">Number to call</Label>
                  <Input id="location" {...register("location")} />
                </>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Panel *</Label>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {users.map((u) => (
                <button key={u._id} type="button" onClick={() => toggle(u._id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition",
                    panel.includes(u._id) ? "bg-primary/10 text-primary" : "hover:bg-muted"
                  )}>
                  <span className="truncate">{u.name}</span>
                  {panel.includes(u._id) && <span className="text-xs">on panel</span>}
                </button>
              ))}
            </div>
            {panel.length === 0 && <p className="text-xs text-muted-foreground">Add at least one interviewer — the invite needs somebody to go to.</p>}
          </div>

          {/* Warned, never blocked: this can only see interviews booked here. */}
          {conflicts.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {conflicts.map((c) => `${c.name} is already with ${c.clashesWith}`).join("; ")}. Only interviews booked
                here are visible — anything in their own calendar is not.
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes for the panel</Label>
            <Textarea id="notes" rows={2} {...register("notes")} />
          </div>

          <ResponsiveDialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || panel.length === 0}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Schedule &amp; send invites
            </Button>
          </ResponsiveDialogFooter>
        </form>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
