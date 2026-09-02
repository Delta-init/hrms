"use client";
import Link from "next/link";
import { ShieldCheck, ArrowUpRight, CheckCircle2, Clock, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn, getInitials } from "@/lib/utils";
import { useApprovalInbox, useApprovalSummary } from "@/hooks/useApprovalInbox";
import { MODULE_TONE, isStale, waitingFor } from "@/components/approvals/shared";

/**
 * What this department has waiting, on the department's own page.
 *
 * The console answers "what is waiting anywhere"; this answers "what is waiting
 * here", which is the question somebody already looking at a department is
 * asking. Without it the two are connected only by the reader remembering to go
 * and filter, and a queue nobody remembers to look at is a queue nobody empties.
 *
 * Read-only on purpose. Deciding carries a confirmation step, a note, a bulk
 * mode and a rejection path, and a second half-built copy of that beside an
 * attendance report is how two versions of the same decision drift apart. The
 * link opens the console already filtered to this department, so acting is one
 * click and one implementation.
 *
 * Drawn only for somebody who has approvals at all — the server answers that
 * with `canAccess`, since a department head holds no permission that would say
 * so from here.
 */
export function DepartmentApprovals({ departmentId, departmentName }: { departmentId: string; departmentName: string }) {
  const { data: access } = useApprovalSummary();
  const enabled = !!access?.canAccess;
  const { data, isLoading } = useApprovalInbox(
    { view: "pending", department: departmentId },
    { enabled }
  );

  if (!enabled) return null;

  const rows = data?.rows ?? [];
  const staleDays = data?.staleAfterDays ?? 7;
  // The console caps each queue; say so rather than letting a short list read
  // as the whole story.
  const capped = data?.capped ?? [];

  return (
    <Card className="mb-6 overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Waiting on approval</h3>
          {rows.length > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
              {rows.length}
            </span>
          )}
        </div>
        <Link
          href={`/approvals?department=${departmentId}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Open in Approvals <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Counting…</p>
      ) : rows.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          Nothing from {departmentName} is waiting on a decision.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.slice(0, 8).map((r) => {
            const stale = isStale(r.raisedAt, staleDays);
            return (
              <li key={`${r.module}-${r.id}`} className="flex items-center gap-3 px-5 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold">
                  {getInitials(r.raisedBy?.name ?? "?")}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.raisedBy?.name ?? "Unknown"}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.title}</p>
                </div>
                <span className={cn("hidden shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium sm:inline", MODULE_TONE[r.module])}>
                  {r.moduleLabel}
                </span>
                {/* Age, not a timestamp: the queue's whole argument is that how
                    long something has waited is the thing worth reacting to. */}
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1 text-xs tabular-nums",
                    stale ? "font-semibold text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                  )}
                >
                  {stale ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                  {waitingFor(r.raisedAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {(rows.length > 8 || capped.length > 0) && (
        <div className="border-t border-border px-5 py-2.5 text-xs text-muted-foreground">
          {rows.length > 8 && `${rows.length - 8} more not shown. `}
          {capped.length > 0 && `Some queues were capped at ${data?.limit}. `}
          <Link href={`/approvals?department=${departmentId}`} className="text-primary hover:underline">
            See them all
          </Link>
        </div>
      )}
    </Card>
  );
}
