"use client";
import { useState } from "react";
import {
  AlertTriangle, BadgeCheck, Check, CheckCircle2, Crown, DownloadCloud, Loader2, Lock, Medal, PartyPopper,
  Send, Undo2, X,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useDgoAchievers, useDgoAchieverStep, formatAed, formatPoints, dgoErrorMessage } from "@/hooks/useDgoPoints";
import {
  DgoGate, LeaderboardTabs, NoteDialog, Notice, Spinner, TableWrap, actionLabel, dateTime, monthLabel,
} from "@/components/dgo/shared";
import type {
  DgoAchieverCandidate, DgoAchieverCategoryResult, DgoAchieverStatus, DgoAchieversView, DgoEliteMetric, DgoMe,
} from "@/types";

export default function DgoAchieversPage() {
  return (
    <DgoGate allow={(me) => me.canUse}>
      {(me) => <AchieversPage me={me} />}
    </DgoGate>
  );
}

const STATUS_LABEL: Record<DgoAchieverStatus, string> = {
  none: "Not started",
  provisional: "Provisional",
  locked: "Locked",
  verified: "Verified",
  published: "Published",
};

const isMentor = (m: DgoEliteMetric) => m.startsWith("mentor_");
const placeLabel = (p: number) => (p === 1 ? "1st" : p === 2 ? "2nd" : p === 3 ? "3rd" : `${p}th`);
const valueText = (metric: DgoEliteMetric, v: number) =>
  isMentor(metric) ? `${Math.round(v * 10) / 10} / 100` : formatAed(Math.round(v));
const thresholdText = (metric: DgoEliteMetric, t: number) =>
  isMentor(metric) ? `score ${t}+` : `${formatAed(t)}+`;

type Intent = "verify" | "send-back" | "approve";

function AchieversPage({ me }: { me: DgoMe }) {
  const [month, setMonth] = useState<string | undefined>(undefined);
  const { data, isLoading, isFetching, error } = useDgoAchievers(month);
  const step = useDgoAchieverStep();
  const [intent, setIntent] = useState<Intent | null>(null);

  const shown = data?.month ?? month;
  const run = (s: "fetch" | Intent, note?: string) => {
    if (!shown) return;
    step.mutate({ month: shown, step: s, ...(note ? { note } : {}) }, { onSuccess: () => setIntent(null) });
  };

  return (
    <div>
      <PageHeader
        title="Monthly Achievers"
        description="The month's elite awards: the top performers who passed their target, paid from the elite pool."
        icon={Medal}
        action={
          data ? (
            <div className="flex items-center gap-2">
              <Select value={data.month} onValueChange={setMonth}>
                <SelectTrigger className="h-9 w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(data.months.some((m) => m.month === data.month) ? data.months : [{ month: data.month, status: data.status }, ...data.months]).map((m) => (
                    <SelectItem key={m.month} value={m.month}>
                      {monthLabel(m.month)}{data.review ? ` · ${STATUS_LABEL[m.status]}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          ) : undefined
        }
      />
      <LeaderboardTabs active="achievers" />

      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <Notice text={dgoErrorMessage(error, "The achievers couldn't be loaded. Try again in a moment.")} />
      ) : !data.review ? (
        <Winners data={data} />
      ) : (
        <Review data={data} busy={step.isPending} onFetch={() => run("fetch")} onIntent={setIntent}
          onPick={(code, email) => shown && step.mutate({ month: shown, step: "pick", code, email })}
          pickingKey={step.isPending && step.variables?.step === "pick" ? `${step.variables.code}:${step.variables.email}` : null}
        />
      )}

      {data && (
        <>
          <NoteDialog
            open={intent === "verify"}
            onOpenChange={(o) => !o && setIntent(null)}
            title="Verify these figures"
            description={`You confirm the amounts behind ${monthLabel(data.month)}'s winners are right. Someone else then approves and publishes.`}
            confirmLabel="Verify"
            tone="good"
            icon={BadgeCheck}
            isPending={step.isPending}
            onConfirm={(note) => run("verify", note)}
          />
          <NoteDialog
            open={intent === "send-back"}
            onOpenChange={(o) => !o && setIntent(null)}
            title="Send back"
            description="The month goes back to provisional. The figures can be fetched again and verified again."
            noteLabel="Reason"
            requireNote
            confirmLabel="Send back"
            tone="danger"
            icon={Undo2}
            isPending={step.isPending}
            onConfirm={(note) => run("send-back", note)}
          />
          <NoteDialog
            open={intent === "approve"}
            onOpenChange={(o) => !o && setIntent(null)}
            title="Approve and publish"
            description={
              <>
                Every prize goes into the winner&apos;s wallet as points ({formatAed(data.pool.prizesAed)} in all, from the elite pool),
                and the winners are announced. This can&apos;t be undone, except by reversing each prize.
              </>
            }
            confirmLabel="Approve & publish"
            tone="good"
            icon={Send}
            isPending={step.isPending}
            onConfirm={(note) => run("approve", note)}
          />
        </>
      )}
    </div>
  );
}

// ─── Everyone: the published winners ──────────────────────────────────────────

function Winners({ data }: { data: DgoAchieversView }) {
  const winners = data.categories.filter((c) => c.winner && (c.award || data.status === "published"));
  if (data.status !== "published" || winners.length === 0) {
    return <Notice icon={Medal} text={`The winners for ${monthLabel(data.month)} haven't been announced yet.`} />;
  }
  return (
    <div className="space-y-5">
      <Card className="flex items-center gap-3 border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-transparent p-4">
        <PartyPopper className="h-6 w-6 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <p className="font-semibold">{monthLabel(data.month)}&apos;s achievers</p>
          <p className="text-sm text-muted-foreground">Congratulations to everyone who made the list.</p>
        </div>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {winners.map((c) => (
          <Card key={c.code} className="flex flex-col items-center gap-2 p-5 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950 shadow">
              {c.place === 1 ? <Crown className="h-6 w-6" /> : <Medal className="h-6 w-6" />}
            </span>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.name}</p>
            <p className="text-lg font-bold leading-tight">{c.award?.employeeName ?? c.winner?.employeeName ?? c.winner?.name}</p>
            <p className="text-sm font-semibold tabular-nums text-amber-600 dark:text-amber-400">
              {formatPoints(c.award?.points ?? c.prizePoints)} points
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Reviewers ────────────────────────────────────────────────────────────────

const STEPS: Array<{ key: DgoAchieverStatus; label: string }> = [
  { key: "provisional", label: "Provisional" },
  { key: "verified", label: "Verified" },
  { key: "published", label: "Published" },
];

function Stepper({ status }: { status: DgoAchieverStatus }) {
  const at = STEPS.findIndex((s) => s.key === status);
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {STEPS.map((s, i) => {
        const done = at > i || status === "published";
        const current = at === i && status !== "published";
        return (
          <li key={s.key} className="flex items-center gap-2">
            {i > 0 && <span className={cn("h-px w-6 sm:w-10", done || current ? "bg-primary" : "bg-border")} />}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                done ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : current ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : <span className="tabular-nums">{i + 1}</span>}
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Review({
  data, busy, onFetch, onIntent, onPick, pickingKey,
}: {
  data: DgoAchieversView;
  busy: boolean;
  onFetch: () => void;
  onIntent: (i: Intent) => void;
  onPick: (code: string, email: string) => void;
  pickingKey: string | null;
}) {
  const p = data.pool;
  const ties = data.categories.filter((c) => c.tie).length;
  return (
    <div className="space-y-5">
      <Card className="space-y-3 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {data.status === "locked" ? (
            <div className="flex items-start gap-2 text-sm">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-semibold">Locked — no elite awards for {monthLabel(data.month)}</p>
                <p className="text-muted-foreground">{data.lockedReason ?? "The company's collections didn't reach the elite threshold."}</p>
              </div>
            </div>
          ) : data.status === "none" ? (
            <p className="text-sm text-muted-foreground">Nothing fetched yet. Once the month has ended, fetch the figures from Root to see who qualified.</p>
          ) : (
            <Stepper status={data.status} />
          )}
          <div className="flex flex-wrap gap-2">
            {data.can.fetch && (
              <Button variant="outline" disabled={busy} onClick={onFetch}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadCloud className="h-4 w-4" />}
                {data.status === "none" ? "Fetch figures from Root" : "Fetch again"}
              </Button>
            )}
            {data.can.sendBack && (
              <Button variant="outline" className="text-red-600 hover:text-red-700" disabled={busy} onClick={() => onIntent("send-back")}>
                <Undo2 className="h-4 w-4" /> Send back
              </Button>
            )}
            {data.can.verify && (
              <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={() => onIntent("verify")}>
                <BadgeCheck className="h-4 w-4" /> Verify
              </Button>
            )}
            {data.can.approve && (
              <Button disabled={busy} onClick={() => onIntent("approve")}>
                <Send className="h-4 w-4" /> Approve &amp; publish
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {data.fetchedAt && <span>Fetched {dateTime(data.fetchedAt)}{data.fetchedByName ? ` by ${data.fetchedByName}` : ""}</span>}
          {data.verifiedAt && <span>Verified {dateTime(data.verifiedAt)}{data.verifiedByName ? ` by ${data.verifiedByName}` : ""}</span>}
          {data.publishedAt && <span>Published {dateTime(data.publishedAt)}{data.publishedByName ? ` by ${data.publishedByName}` : ""}</span>}
        </div>
        {ties > 0 && data.status === "provisional" && (
          <p className="flex items-center gap-1.5 text-xs font-medium text-orange-700 dark:text-orange-400">
            <AlertTriangle className="h-3.5 w-3.5" /> {ties} {ties === 1 ? "category has" : "categories have"} an exact tie. Pick the winner before it can be verified.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Elite pool</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{p.eliteAed > 0 ? formatAed(p.eliteAed) : "Locked"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Prizes</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{formatAed(p.prizesAed)}</p>
        </Card>
        <Card className={cn("p-4", !p.fits && "border-red-500/40")}>
          <p className="text-xs font-medium text-muted-foreground">Fits the pool?</p>
          <p className={cn("mt-1 flex items-center gap-1.5 text-xl font-bold", p.fits ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
            {p.fits ? <CheckCircle2 className="h-5 w-5" /> : <X className="h-5 w-5" />} {p.fits ? "Yes" : "No"}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Collections confirmed</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{p.collectionsConfirmedAed != null ? formatAed(p.collectionsConfirmedAed) : "Not yet"}</p>
          <p className="text-xs text-muted-foreground">needs {formatAed(p.thresholdAed)}</p>
        </Card>
      </div>

      {data.problems.length > 0 && (
        <Card className="border-orange-500/30 bg-orange-500/5 p-4">
          <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-orange-800 dark:text-orange-300"><AlertTriangle className="h-4 w-4" /> Some figures couldn&apos;t be read</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-orange-900/80 dark:text-orange-200/80">
            {data.problems.map((pr, i) => <li key={i}>{pr}</li>)}
          </ul>
        </Card>
      )}

      {data.categories.length === 0 ? (
        data.status !== "none" && <Notice icon={Medal} text="No categories are switched on. Turn them on in Points Rules." />
      ) : (
        <div className="space-y-4">
          {data.categories.map((c) => (
            <CategoryCard key={c.code} c={c} canPick={data.can.pick} onPick={onPick} pickingKey={pickingKey} />
          ))}
        </div>
      )}

      {data.trail.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">History</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {data.trail.map((t, i) => (
              <li key={i}>
                {dateTime(t.at)} · <span className="font-medium text-foreground">{actionLabel(t.action)}</span>
                {t.byName ? ` by ${t.byName}` : ""}{t.note ? `: ${t.note}` : ""}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function CategoryCard({
  c, canPick, onPick, pickingKey,
}: {
  c: DgoAchieverCategoryResult;
  canPick: boolean;
  onPick: (code: string, email: string) => void;
  pickingKey: string | null;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{c.name}</p>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{placeLabel(c.place)} · {thresholdText(c.metric, c.threshold)}</span>
          </div>
          <div className="mt-2">
            {c.award?.takenBack ? (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Undo2 className="h-4 w-4 text-amber-600" /> Paid to <span className="font-semibold">{c.award.employeeName}</span>, then taken back by finance · no longer announced</p>
            ) : c.award ? (
              <p className="flex items-center gap-1.5 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Paid to <span className="font-semibold">{c.award.employeeName}</span> · {formatPoints(c.award.points)} points</p>
            ) : c.winner ? (
              <p className="flex items-center gap-1.5 text-sm">
                <Crown className="h-4 w-4 text-amber-500" />
                <span className="font-semibold">{c.winner.employeeName ?? c.winner.name}</span>
                <span className="text-muted-foreground">· {valueText(c.metric, c.winner.value)}</span>
                {c.pickedByName && <span className="text-xs text-muted-foreground">(picked by {c.pickedByName})</span>}
              </p>
            ) : c.tie ? (
              <p className="flex items-center gap-1.5 text-sm font-medium text-orange-700 dark:text-orange-400"><AlertTriangle className="h-4 w-4" /> Tie — pick the winner</p>
            ) : (
              <p className="text-sm text-muted-foreground">No one qualified.</p>
            )}
          </div>
        </div>
        <div className="shrink-0 sm:text-right">
          <p className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">{formatAed(c.prizeAed)}</p>
          <p className="text-xs text-muted-foreground">{formatPoints(c.prizePoints)} points</p>
        </div>
      </div>
      {c.candidates.length > 0 && (
        <TableWrap>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Person</th>
                <th className="px-4 py-2 text-right font-medium">{isMentor(c.metric) ? "Score" : "Amount"}</th>
                <th className="px-4 py-2 font-medium">Counts?</th>
                {canPick && c.tie && <th className="px-4 py-2"><span className="sr-only">Pick</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {c.candidates.map((p) => (
                <CandidateRow key={p.email} c={c} p={p} canPick={canPick} onPick={onPick} busy={pickingKey === `${c.code}:${p.email}`} />
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

function CandidateRow({
  c, p, canPick, onPick, busy,
}: {
  c: DgoAchieverCategoryResult;
  p: DgoAchieverCandidate;
  canPick: boolean;
  onPick: (code: string, email: string) => void;
  busy: boolean;
}) {
  const isWinner = c.winner?.email === p.email;
  return (
    <tr className={cn(isWinner && "bg-amber-500/5", !p.eligible && "text-muted-foreground")}>
      <td className="px-4 py-2">
        <div className="min-w-[12rem]">
          <p className="font-medium text-foreground">
            {p.employeeName ?? p.name}
            {isWinner && <Crown className="ml-1 inline h-3.5 w-3.5 text-amber-500" />}
            {p.tied && <span className="ml-2 rounded-full bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 dark:text-orange-400">Tied</span>}
          </p>
          <p className="text-xs text-muted-foreground">{[p.detail, !p.employeeId ? "not in HRMS" : null].filter(Boolean).join(" · ") || p.email}</p>
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{valueText(c.metric, p.value)}</td>
      <td className="px-4 py-2 text-xs">
        {p.eligible ? (
          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><Check className="h-3.5 w-3.5" /> Yes</span>
        ) : (
          <span>{p.why ?? "No"}</span>
        )}
      </td>
      {canPick && c.tie && (
        <td className="px-4 py-2 text-right">
          {p.tied && p.eligible && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onPick(c.code, p.email)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />} Pick
            </Button>
          )}
        </td>
      )}
    </tr>
  );
}
