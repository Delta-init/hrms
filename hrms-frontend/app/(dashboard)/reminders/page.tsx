"use client";
import { useState } from "react";
import { AlarmClock, Plus, X, Loader2, Users, User2, Globe } from "lucide-react";
import { useMyReminders, useCancelReminder } from "@/hooks/useReminders";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ReminderDialog } from "@/components/reminders/ReminderDialog";
import { cn } from "@/lib/utils";
import { REMINDER_AUDIENCE_LABELS, type Reminder, type ReminderAudience, type ReminderStatus } from "@/types";

const AUDIENCE_ICON: Record<ReminderAudience, typeof Users> = { everyone: Globe, team: Users, self: User2 };
const STATUS_STYLES: Record<ReminderStatus, string> = {
  scheduled: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  sent: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  cancelled: "bg-muted text-muted-foreground border-border",
};
const fmtDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

export default function RemindersPage() {
  const { data: reminders = [], isLoading } = useMyReminders();
  const { mutate: cancel, isPending: cancelling } = useCancelReminder();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Reminder | null>(null);

  return (
    <div>
      <PageHeader
        title="Reminders"
        description="One-off nudges — for yourself, your team, or everyone."
        icon={AlarmClock}
        action={<Button onClick={() => setDialogOpen(true)} className="shadow-sm"><Plus className="h-4 w-4" />New Reminder</Button>}
      />

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : reminders.length === 0 ? (
        <Card className="p-16 text-center text-muted-foreground">
          <AlarmClock className="mx-auto mb-2 h-7 w-7" />
          No reminders yet.
        </Card>
      ) : (
        <div className="space-y-3">
          {reminders.map((r) => {
            const AudienceIcon = AUDIENCE_ICON[r.audience];
            return (
              <Card key={r._id} className="group p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{r.title}</h3>
                      <Badge variant="outline" className={cn("capitalize", STATUS_STYLES[r.status])}>{r.status}</Badge>
                    </div>
                    {r.message && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{r.message}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5"><AudienceIcon className="h-3.5 w-3.5" />{REMINDER_AUDIENCE_LABELS[r.audience]}</span>
                      <span>·</span>
                      <span>{fmtDate(r.date)}{r.time ? ` at ${r.time}` : " (all day)"}</span>
                    </div>
                  </div>
                  {r.status === "scheduled" && (
                    <Button
                      size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-destructive opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => setCancelTarget(r)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ReminderDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <ConfirmDialog
        open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}
        title="Cancel reminder" description="This reminder will not be sent." isPending={cancelling}
        onConfirm={() => cancelTarget && cancel(cancelTarget._id, { onSuccess: () => setCancelTarget(null) })}
      />
    </div>
  );
}
