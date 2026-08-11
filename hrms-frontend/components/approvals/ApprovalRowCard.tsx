"use client";
import { Check, X, Eye, Building2, Clock, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { ApprovalRow } from "@/types";
import { MODULE_TONE, fmtDateTime, isStale, waitingFor } from "./shared";

interface Props {
  row: ApprovalRow;
  /** The server's threshold, so the console and the dashboard agree. */
  staleAfterDays?: number;
  /** Only the waiting queue can be selected — you cannot re-decide history. */
  selectable: boolean;
  selected: boolean;
  /** Bulk runs one module at a time, so the rest lock once one is picked. */
  lockedOut: boolean;
  onSelect: (checked: boolean) => void;
  onView: () => void;
  onDecide: (approve: boolean) => void;
  isPending: boolean;
}

/**
 * One waiting thing, whatever kind of thing it is.
 *
 * Every row carries its organisation and its type, because in a list that
 * deliberately mixes both, a title on its own is ambiguous — "3 days annual
 * leave" means nothing until you know whose company it is.
 */
export function ApprovalRowCard({
  row, staleAfterDays, selectable, selected, lockedOut, onSelect, onView, onDecide, isPending,
}: Props) {
  const stale = !row.decided && isStale(row.raisedAt, staleAfterDays);
  const decided = row.decided ?? null;

  return (
    <div
      className={cn(
        "flex gap-3 rounded-xl border bg-card p-3 shadow-sm transition-colors sm:p-4",
        selected ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/30"
      )}
    >
      {selectable && (
        <div className="pt-1">
          <Checkbox
            checked={selected}
            disabled={lockedOut}
            onCheckedChange={(c) => onSelect(c === true)}
            aria-label={`Select ${row.title}`}
            className={lockedOut ? "opacity-30" : undefined}
          />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className={cn("rounded-full border px-2 py-0.5 font-medium", MODULE_TONE[row.module])}>
            {row.moduleLabel}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-muted-foreground">
            <Building2 className="h-3 w-3" />{row.organization.name ?? "No organisation"}
          </span>
          {row.chain && (
            <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
              Step {row.chain.step}/{row.chain.total} · {row.chain.waitingOn}
            </span>
          )}
          {stale && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" />waiting {waitingFor(row.raisedAt)}
            </span>
          )}
        </div>

        <p className="mt-1.5 truncate text-sm font-semibold">{row.title}</p>

        <p className="mt-0.5 text-xs text-muted-foreground">
          {row.raisedBy?.name ?? "—"}
          {decided ? (
            <> · raised {fmtDateTime(row.raisedAt)}</>
          ) : (
            <> · <Clock className="inline h-3 w-3" /> {waitingFor(row.raisedAt)}</>
          )}
        </p>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {row.summary.map((s) => (
            <span key={s.label} className="text-muted-foreground">
              {s.label}: <span className="text-foreground">{s.value}</span>
            </span>
          ))}
        </div>

        {decided && (
          <p className={cn(
            "mt-2 inline-flex flex-wrap items-center gap-1.5 text-xs font-medium",
            decided.outcome === "approved" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
          )}>
            {decided.outcome === "approved" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            <span className="capitalize">{decided.outcome}</span>
            <span className="font-normal text-muted-foreground">
              {decided.by ? `by ${decided.by.name} ` : ""}· {fmtDateTime(decided.at)}
              {decided.note ? ` — “${decided.note}”` : ""}
            </span>
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={onView} aria-label={`View ${row.title}`} className="h-8 px-2 text-muted-foreground">
          <Eye className="h-4 w-4" /><span className="hidden sm:inline">View</span>
        </Button>
        {!decided && (
          <div className="flex gap-1.5">
            <Button
              variant="outline" size="sm" disabled={isPending} onClick={() => onDecide(false)}
              className="h-8 border-red-500/30 px-2 text-red-600 hover:bg-red-500/10 dark:text-red-400"
              aria-label="Reject"
            >
              <X className="h-4 w-4" />
            </Button>
            <Button
              size="sm" disabled={isPending} onClick={() => onDecide(true)}
              className="h-8 bg-emerald-600 px-2 hover:bg-emerald-700"
              aria-label="Approve"
            >
              <Check className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
