"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, FileText, HeartHandshake, Inbox, Loader2, Send, ShieldCheck, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  useDgoNominations, useNominate, newRequestId, formatAed, formatPoints, dgoErrorMessage,
} from "@/hooks/useDgoPoints";
import {
  DgoColleagueSelect, DgoFileUpload, DgoGate, Notice, Spinner, StageChain, StatusPill,
  STAGE_LABEL, actionLabel, dateTime, shiftMonth, shortDay,
} from "@/components/dgo/shared";
import type { DgoEvent, DgoMe, DgoNominationRule, DgoNominationsTab, DgoNominationsView, DgoUpload } from "@/types";

export default function DgoNominationsPage() {
  return (
    <DgoGate allow={(me) => me.canUse}>
      {(me) => <NominationsPage me={me} />}
    </DgoGate>
  );
}

function NominationsPage({ me }: { me: DgoMe }) {
  const [tab, setTab] = useState<DgoNominationsTab>("sent");
  const [dialog, setDialog] = useState<{ open: boolean; ruleCode: string }>({ open: false, ruleCode: "" });
  const { data, isLoading, isFetching, error } = useDgoNominations(tab);
  const canNominate = !!me.can.nominate;
  const left = data?.left ?? 0;

  return (
    <div>
      <PageHeader
        title="Nominate a colleague"
        description="Seen someone go the extra mile? Say what they did. Their department head and HR approve it, then the points are theirs."
        icon={HeartHandshake}
        action={
          canNominate ? (
            <div className="flex flex-wrap items-center gap-2">
              {data && <LeftChip data={data} />}
              <Button onClick={() => setDialog({ open: true, ruleCode: "" })} disabled={!data || left <= 0}>
                <Send className="h-4 w-4" /> Nominate
              </Button>
            </div>
          ) : undefined
        }
      />

      {!canNominate && (
        <div className="mb-5">
          <Notice text={me.employee ? "You can't send nominations right now." : "Your login isn't linked to an employee record, so you can't send nominations."} />
        </div>
      )}

      {data && data.rules.length > 0 && canNominate && (
        <div className="mb-6">
          <p className="mb-2 text-sm font-semibold">What you can nominate for</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.rules.map((r) => (
              <RuleCard key={r.code} rule={r} disabled={left <= 0} onPick={() => setDialog({ open: true, ruleCode: r.code })} />
            ))}
          </div>
          {left <= 0 && (
            <p className="mt-2 text-xs text-muted-foreground">You&apos;ve used all {data.limit} nominations for this month. You get {data.limit} more on the 1st.</p>
          )}
        </div>
      )}

      <Tabs
        layoutId="dgo-nominations-tabs"
        value={tab}
        onChange={(k) => setTab(k as DgoNominationsTab)}
        tabs={[
          { key: "sent", label: "Sent by me", icon: Send, count: data?.counts.sent },
          { key: "received", label: "Received", icon: Sparkles, count: data?.counts.received },
        ]}
      />

      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <Notice text={dgoErrorMessage(error, "Nominations couldn't be loaded. Try again in a moment.")} />
      ) : data.items.length === 0 ? (
        <Notice
          icon={Inbox}
          text={tab === "sent" ? "You haven't nominated anyone yet." : "No approved nominations for you yet. When a colleague's nomination of you is approved, it shows here."}
        />
      ) : (
        <div className="space-y-3">
          {isFetching && !isLoading && (
            <div className="flex justify-end"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          )}
          {data.items.map((ev) => <NominationCard key={ev.id} ev={ev} tab={tab} />)}
        </div>
      )}

      {canNominate && data && (
        <NominateDialog
          me={me}
          rules={data.rules}
          left={left}
          initialRule={dialog.ruleCode}
          open={dialog.open}
          onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        />
      )}
    </div>
  );
}

function LeftChip({ data }: { data: DgoNominationsView }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold",
        data.left > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      {data.left} of {data.limit} nominations left this month
    </span>
  );
}

function chainText(rule: Pick<DgoNominationRule, "chain">) {
  return rule.chain.length ? `Approved by ${rule.chain.map((s) => STAGE_LABEL[s]).join(", then ")}` : "No approval needed";
}

function RuleCard({ rule, onPick, disabled }: { rule: DgoNominationRule; onPick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      className="group flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">{rule.name}</p>
        <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-bold tabular-nums text-amber-700 dark:text-amber-400">
          {formatPoints(rule.points)} pts
        </span>
      </div>
      {rule.description && <p className="text-sm text-muted-foreground">{rule.description}</p>}
      <div className="mt-auto flex flex-wrap gap-1.5 pt-1 text-[11px]">
        <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{chainText(rule)}</span>
        {rule.needsEvidence && <span className="rounded-full bg-sky-500/10 px-2 py-0.5 font-medium text-sky-700 dark:text-sky-400">Needs evidence</span>}
        {rule.capExempt && <span className="rounded-full bg-violet-500/10 px-2 py-0.5 font-medium text-violet-700 dark:text-violet-400">Outside daily cap</span>}
      </div>
    </button>
  );
}

function NominationCard({ ev, tab }: { ev: DgoEvent; tab: DgoNominationsTab }) {
  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">
              {tab === "sent" ? ev.employee.name : `From ${ev.submittedByName ?? "a colleague"}`}
            </p>
            {tab === "sent" && ev.employee.department && <span className="text-xs text-muted-foreground">{ev.employee.department}</span>}
            <StatusPill status={ev.status} />
          </div>
          <p className="text-sm">
            <span className="font-medium">{ev.ruleName}</span>
            <span className="text-muted-foreground"> · {shortDay(ev.day)}</span>
          </p>
          <p className="text-sm text-muted-foreground">{ev.reason}</p>
          {(ev.evidenceNote || ev.evidenceUrl) && (
            <div className="space-y-1 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs">
              {ev.evidenceNote && <p><span className="font-medium">Evidence:</span> {ev.evidenceNote}</p>}
              {ev.evidenceUrl && (
                <a href={ev.evidenceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                  <FileText className="h-3.5 w-3.5" /> {ev.evidenceName || "Attached file"}
                </a>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
            <StageChain chain={ev.chain} stage={ev.stage} status={ev.status} trail={ev.trail} />
            <span className="text-xs text-muted-foreground">Sent {dateTime(ev.createdAt)}</span>
          </div>
          {ev.trail.some((t) => t.note) && (
            <ul className="space-y-0.5 pt-1 text-xs text-muted-foreground">
              {ev.trail.filter((t) => t.note).map((t, i) => (
                <li key={i}>
                  <span className="font-medium text-foreground">{t.byName ?? "System"}</span>
                  {t.stage ? ` (${STAGE_LABEL[t.stage]})` : ""} {actionLabel(t.action).toLowerCase()}: {t.note}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="shrink-0 text-left md:text-right">
          <p className={cn("text-lg font-bold tabular-nums", ev.status === "posted" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
            +{formatPoints(ev.points)} pts
          </p>
          <p className="text-xs text-muted-foreground">{formatAed(ev.aed)}</p>
          {ev.status === "posted" && (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Paid</p>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * The nomination form. The day can be today or any earlier day this month or
 * last; the server checks the limit, the cap and the budget again either way.
 */
function NominateDialog({
  me, rules, left, initialRule, open, onOpenChange,
}: {
  me: DgoMe;
  rules: DgoNominationRule[];
  left: number;
  initialRule: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const nominate = useNominate();
  const [employeeId, setEmployeeId] = useState("");
  const [ruleCode, setRuleCode] = useState("");
  const [day, setDay] = useState(me.today);
  const [reason, setReason] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [file, setFile] = useState<DgoUpload | null>(null);
  const [requestId, setRequestId] = useState(newRequestId);

  // Every opening is a new nomination: a new id, a clean form.
  useEffect(() => {
    if (!open) return;
    setEmployeeId(""); setRuleCode(initialRule); setDay(me.today); setReason(""); setEvidenceNote(""); setFile(null);
    setRequestId(newRequestId());
  }, [open, initialRule, me.today]);

  const earliest = `${shiftMonth(me.today.slice(0, 7), -1)}-01`;
  const rule = rules.find((r) => r.code === ruleCode);
  const missing =
    left <= 0 ? "No nominations left this month"
      : !employeeId ? "Choose a colleague"
        : !rule ? "Choose what it is for"
          : !day ? "Pick the day"
            : day > me.today ? "The day can't be in the future"
              : day < earliest ? "Pick a day this month or last month"
                : !reason.trim() ? "Say what they did"
                  : rule.needsEvidence && !evidenceNote.trim() && !file ? "This one needs evidence: a note or a file"
                    : null;

  const submit = () => {
    if (missing || !rule) return;
    nominate.mutate(
      {
        employeeId,
        ruleCode: rule.code,
        day,
        reason: reason.trim(),
        ...(evidenceNote.trim() ? { evidenceNote: evidenceNote.trim() } : {}),
        ...(file ? { evidenceKey: file.key, evidenceName: file.fileName } : {}),
        requestId,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Nominate a colleague</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
            You can&apos;t nominate yourself. {left} of your nominations left this month.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label>Colleague</Label>
            <DgoColleagueSelect value={employeeId} onChange={setEmployeeId} className="w-full" />
          </div>

          <div className="space-y-1.5">
            <Label>For</Label>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="What it is for">
              {rules.map((r) => (
                <button
                  key={r.code}
                  type="button"
                  role="radio"
                  aria-checked={ruleCode === r.code}
                  onClick={() => setRuleCode(r.code)}
                  className={cn(
                    "rounded-lg border p-3 text-left text-sm transition-colors",
                    ruleCode === r.code ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-xs font-bold tabular-nums text-amber-700 dark:text-amber-400">{r.points} pts</span>
                  </span>
                  {r.needsEvidence && <span className="mt-0.5 block text-[11px] text-sky-700 dark:text-sky-400">Needs evidence</span>}
                </button>
              ))}
            </div>
            {rule && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {rule.points} points = {formatAed(rule.aed)}. {chainText(rule)}.
                  {rule.capExempt ? " Outside the daily cap." : ""}
                </span>
              </p>
            )}
          </div>

          <div className="space-y-1.5 sm:max-w-[14rem]">
            <Label htmlFor="dgo-nom-day">When it happened</Label>
            <Input id="dgo-nom-day" type="date" value={day} min={earliest} max={me.today} onChange={(e) => setDay(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dgo-nom-reason">What they did</Label>
            <Textarea id="dgo-nom-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="Short and specific — this is what the approvers read." />
            <p className="text-right text-[11px] text-muted-foreground">{reason.length}/1000</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dgo-nom-evidence">Evidence {rule?.needsEvidence ? "(a note or a file is required)" : "(optional)"}</Label>
            <Textarea id="dgo-nom-evidence" rows={2} value={evidenceNote} onChange={(e) => setEvidenceNote(e.target.value)} maxLength={2000} placeholder="Where to see it: a ticket number, a review, a message…" />
            <DgoFileUpload kind="evidence" value={file} onChange={setFile} disabled={nominate.isPending} />
          </div>
        </div>

        <ResponsiveDialogFooter>
          {missing && <p className="mr-auto self-center text-xs text-muted-foreground">{missing}</p>}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={nominate.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={!!missing || nominate.isPending}>
            {nominate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send nomination
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
