"use client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSetRequisitionStanding } from "@/hooks/useHiring";
import { cn } from "@/lib/utils";
import {
  REQUISITION_PRIORITY_LABELS, REQUISITION_STATUS_LABELS,
  type JobRequisition, type RequisitionPriority, type RequisitionState,
} from "@/types";

export const PRIORITY_TONE: Record<RequisitionPriority, string> = {
  urgent: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
  high: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  normal: "border-border bg-muted text-muted-foreground",
  low: "border-sky-500/20 bg-sky-500/5 text-sky-700 dark:text-sky-400",
};
const PRIORITIES: RequisitionPriority[] = ["urgent", "high", "normal", "low"];

const STATE_OF: Partial<Record<JobRequisition["status"], RequisitionState>> = { approved: "active", closed: "closed", cancelled: "cancelled" };
const STATE_TONE: Record<RequisitionState, string> = {
  active: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  closed: "border-primary/30 bg-primary/10 text-primary",
  cancelled: "border-border bg-muted text-muted-foreground",
};

/**
 * Whether a requisition has been approved and so moves between active, closed
 * and cancelled — mirrors setStanding() on the server. Filled counts: more
 * people may be needed after all. Withdrawn before any decision does not.
 */
export const hasStanding = (r: JobRequisition) =>
  ["approved", "closed", "filled"].includes(r.status) || (r.status === "cancelled" && !r.withdrawnAt);

export function PriorityBadge({ priority }: { priority?: RequisitionPriority }) {
  const p = priority ?? "normal";
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", PRIORITY_TONE[p])}>
      {REQUISITION_PRIORITY_LABELS[p]}
    </span>
  );
}

/** The priority, changeable in place by whoever may — a badge for everyone else. */
export function PrioritySelect({ requisition, canChange }: { requisition: JobRequisition; canChange: boolean }) {
  const { mutate, isPending } = useSetRequisitionStanding();
  const p = requisition.priority ?? "normal";
  if (!canChange) return <PriorityBadge priority={p} />;
  return (
    <Select value={p} disabled={isPending} onValueChange={(v) => v !== p && mutate({ id: requisition._id, priority: v as RequisitionPriority })}>
      <SelectTrigger className={cn("h-7 w-[104px] rounded-full border px-2.5 text-xs font-medium", PRIORITY_TONE[p])} aria-label="Priority">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PRIORITIES.map((x) => <SelectItem key={x} value={x}>{REQUISITION_PRIORITY_LABELS[x]}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/**
 * Active / Closed / Cancelled, set straight from the row once approved. A
 * filled requisition reads "Filled" until somebody moves it on.
 */
export function StateSelect({ requisition }: { requisition: JobRequisition }) {
  const { mutate, isPending } = useSetRequisitionStanding();
  const state = STATE_OF[requisition.status];
  return (
    <Select value={state ?? "filled"} disabled={isPending} onValueChange={(v) => v !== state && mutate({ id: requisition._id, state: v as RequisitionState })}>
      <SelectTrigger className={cn("h-7 w-[118px] rounded-full border px-2.5 text-xs font-medium", state ? STATE_TONE[state] : STATE_TONE.closed)} aria-label="Status">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {!state && <SelectItem value="filled" disabled>{REQUISITION_STATUS_LABELS.filled}</SelectItem>}
        <SelectItem value="active">Active</SelectItem>
        <SelectItem value="closed">Closed</SelectItem>
        <SelectItem value="cancelled">Cancelled</SelectItem>
      </SelectContent>
    </Select>
  );
}

const DAY_MS = 86_400_000;
/** Today, as a date with no time — what "wanted by" is compared against. */
const todayUtc = () => { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };

/**
 * When the role is wanted by, coloured by how close it is — for a requisition
 * still open: green from 15 days out, yellow from 7, red from 5, and red
 * "overdue" once it has passed. Closed and cancelled ones just show the date.
 */
export function DeadlineCell({ requisition, fmt }: { requisition: JobRequisition; fmt: (iso?: string | null) => string }) {
  const iso = requisition.targetStartDate;
  const open = ["pending", "finance_pending", "approved", "on_hold", "draft"].includes(requisition.status);
  if (!iso || !open) return <span className="text-muted-foreground">{fmt(iso)}</span>;
  const wanted = new Date(iso);
  const left = Math.round((Date.UTC(wanted.getUTCFullYear(), wanted.getUTCMonth(), wanted.getUTCDate()) - todayUtc()) / DAY_MS);
  const [tone, note] =
    left < 0 ? ["text-red-600 dark:text-red-400 font-medium", `Overdue by ${-left} day${left === -1 ? "" : "s"}`]
    : left === 0 ? ["text-red-600 dark:text-red-400 font-medium", "Due today"]
    : left <= 5 ? ["text-red-600 dark:text-red-400", `in ${left} day${left === 1 ? "" : "s"}`]
    : left <= 7 ? ["text-amber-600 dark:text-amber-400", `in ${left} days`]
    : left <= 15 ? ["text-emerald-600 dark:text-emerald-400", `in ${left} days`]
    : ["text-muted-foreground", null];
  return (
    <div className={cn("leading-tight", tone)}>
      <div>{fmt(iso)}</div>
      {note && <div className="text-[11px]">{note}</div>}
    </div>
  );
}
