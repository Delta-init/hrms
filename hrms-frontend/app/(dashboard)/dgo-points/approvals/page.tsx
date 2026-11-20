"use client";
import { useEffect, useState } from "react";
import { BadgeCheck, Check, History, Inbox, Info, ListChecks, Loader2, Plus, Undo2, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { ReviewDialog } from "@/components/shared/ReviewDialog";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  useDgoApprovals, useDecideDgoPoints, useReverseDgoPoints, formatAed, formatPoints, dgoErrorMessage,
} from "@/hooks/useDgoPoints";
import { RecordPointsDialog } from "@/components/dgo/RecordPointsDialog";
import { DgoGate, Notice, Spinner, StageChain, StatusPill, STAGE_LABEL, dateTime, shortDay } from "@/components/dgo/shared";
import type { DgoApprovalsView, DgoEvent, DgoMe } from "@/types";

type Tab = DgoApprovalsView["tab"];

export default function DgoApprovalsPage() {
  return (
    <DgoGate
      allow={(me) => me.can.approvals || me.can.recordAwards}
      deniedText="Points approvals are for department heads, HR and finance."
    >
      {(me) => <ApprovalsPage me={me} />}
    </DgoGate>
  );
}

function ApprovalsPage({ me }: { me: DgoMe }) {
  const [tab, setTab] = useState<Tab>("mine");
  const [recordOpen, setRecordOpen] = useState(false);
  const [intent, setIntent] = useState<{ event: DgoEvent; approve: boolean } | null>(null);
  const [reversing, setReversing] = useState<DgoEvent | null>(null);
  const { data, isLoading, isFetching, error } = useDgoApprovals(tab);
  const decide = useDecideDgoPoints();

  const counts = data?.counts;

  return (
    <div>
      <PageHeader
        title="Points Approvals"
        description="Recognition waiting on you, everything still waiting, and what you have decided."
        icon={BadgeCheck}
        action={
          me.can.recordAwards ? (
            <Button onClick={() => setRecordOpen(true)}>
              <Plus className="h-4 w-4" /> Record points
            </Button>
          ) : undefined
        }
      />

      <Tabs
        layoutId="dgo-approvals-tabs"
        value={tab}
        onChange={(k) => setTab(k as Tab)}
        tabs={[
          { key: "mine", label: "Waiting on me", icon: Inbox, count: counts?.mine },
          { key: "waiting", label: "All waiting", icon: ListChecks, count: counts?.waiting },
          { key: "decided", label: "Decided by me", icon: History, count: counts?.decided },
        ]}
      />

      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <Notice text={dgoErrorMessage(error, "The queue couldn't be loaded. Try again in a moment.")} />
      ) : data.items.length === 0 ? (
        <Notice
          icon={Inbox}
          text={
            tab === "mine" ? "Nothing is waiting on you."
              : tab === "waiting" ? "Nothing is waiting for approval."
                : "You haven't decided anything yet."
          }
        />
      ) : (
        <div className="space-y-3">
          {isFetching && !isLoading && (
            <div className="flex justify-end"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          )}
          {data.items.map((ev) => (
            <EventCard
              key={ev.id}
              ev={ev}
              busy={decide.isPending && decide.variables?.id === ev.id}
              onApprove={() => setIntent({ event: ev, approve: true })}
              onReject={() => setIntent({ event: ev, approve: false })}
              onReverse={() => setReversing(ev)}
            />
          ))}
        </div>
      )}

      {me.can.recordAwards && <RecordPointsDialog me={me} open={recordOpen} onOpenChange={setRecordOpen} />}

      <ReviewDialog
        open={!!intent}
        onOpenChange={(o) => !o && setIntent(null)}
        action={intent?.approve ? "approved" : "rejected"}
        subject={intent ? `${intent.event.ruleName} for ${intent.event.employee.name} · ${intent.event.points} points` : undefined}
        requireNote={intent ? !intent.approve : false}
        isPending={decide.isPending}
        onConfirm={(note) => {
          if (!intent) return;
          decide.mutate(
            { id: intent.event.id, approve: intent.approve, ...(note.trim() ? { note: note.trim() } : {}) },
            { onSuccess: () => setIntent(null) },
          );
        }}
      />

      <ReverseDialog event={reversing} onOpenChange={(o) => !o && setReversing(null)} />
    </div>
  );
}

function EventCard({
  ev, busy, onApprove, onReject, onReverse,
}: {
  ev: DgoEvent;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onReverse: () => void;
}) {
  const overBudget = ev.budget && ev.budget.afterAed < 0;
  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{ev.employee.name}</p>
            {ev.employee.department && <span className="text-xs text-muted-foreground">{ev.employee.department}</span>}
            <StatusPill status={ev.status} />
          </div>
          <p className="text-sm">
            <span className="font-medium">{ev.ruleName}</span>
            <span className="text-muted-foreground"> · {shortDay(ev.day)}{ev.kpiKey ? ` · KPI ${ev.kpiKey}` : ""}</span>
          </p>
          <p className="text-sm text-muted-foreground">{ev.reason}</p>
          {ev.evidenceNote && (
            <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-xs"><span className="font-medium">Evidence:</span> {ev.evidenceNote}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
            <StageChain chain={ev.chain} stage={ev.stage} status={ev.status} trail={ev.trail} />
            {ev.submittedByName && <span className="text-xs text-muted-foreground">Recorded by {ev.submittedByName} · {dateTime(ev.createdAt)}</span>}
          </div>
          {ev.trail.some((t) => t.note) && (
            <ul className="space-y-0.5 pt-1 text-xs text-muted-foreground">
              {ev.trail.filter((t) => t.note).map((t, i) => (
                <li key={i}>
                  <span className="font-medium text-foreground">{t.byName ?? "System"}</span>
                  {t.stage ? ` (${STAGE_LABEL[t.stage]})` : ""} {t.action}: {t.note}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 md:items-end">
          <div className="text-left md:text-right">
            <p className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">+{formatPoints(ev.points)} pts</p>
            <p className="text-xs text-muted-foreground">{formatAed(ev.aed)}</p>
          </div>
          {ev.budget && (
            <p className={cn("text-xs md:text-right", overBudget ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
              {ev.budget.departmentName}: {formatAed(ev.budget.leftAed)} left
              {ev.status === "pending" && <> → {formatAed(ev.budget.afterAed)} after</>}
            </p>
          )}
          {ev.canDecide ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" disabled={busy} onClick={onReject}>
                <X className="h-4 w-4" /> Reject
              </Button>
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={onApprove}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
              </Button>
            </div>
          ) : ev.status === "pending" && ev.whyNot ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground md:justify-end"><Info className="h-3.5 w-3.5" /> {ev.whyNot}</p>
          ) : null}
          {ev.canReverse && (
            <Button size="sm" variant="outline" onClick={onReverse}>
              <Undo2 className="h-4 w-4" /> Reverse
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Taking posted points back. Needs a reason: it is a line on the person's points for ever. */
function ReverseDialog({ event, onOpenChange }: { event: DgoEvent | null; onOpenChange: (open: boolean) => void }) {
  const reverse = useReverseDgoPoints();
  const [reason, setReason] = useState("");
  useEffect(() => { if (event) setReason(""); }, [event]);

  return (
    <ResponsiveDialog open={!!event} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Reverse these points</ResponsiveDialogTitle>
          {event && (
            <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
              {event.points} points for {event.ruleName} on {shortDay(event.day)} come off {event.employee.name}&apos;s points.
              The original line stays; the reversal is added beside it.
            </ResponsiveDialogDescription>
          )}
        </ResponsiveDialogHeader>
        <div className="space-y-2 px-4 sm:px-0">
          <Label htmlFor="dgo-reverse-reason">Reason (required)</Label>
          <Textarea id="dgo-reverse-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Why these points are being taken back…" />
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={reverse.isPending}>Cancel</Button>
          <Button
            className="bg-red-600 hover:bg-red-700"
            disabled={!reason.trim() || reverse.isPending || !event}
            onClick={() => event && reverse.mutate({ id: event.id, reason: reason.trim() }, { onSuccess: () => onOpenChange(false) })}
          >
            {reverse.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
            Reverse
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
