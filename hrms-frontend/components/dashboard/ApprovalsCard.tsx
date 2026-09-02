"use client";
import Link from "next/link";
import { ShieldCheck, ArrowUpRight, AlertTriangle, Building2, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useApprovalSummary } from "@/hooks/useApprovalInbox";
import { MODULE_TONE, waitingFor } from "@/components/approvals/shared";
import type { ApprovalModule } from "@/types";

/**
 * What is waiting on management, on the page they already open.
 *
 * The console only helps somebody who goes looking. This is the part that makes
 * them look: the number, how long the worst of it has been sitting, and which
 * kinds — so the decision to open it can be made without opening it.
 *
 * The card decides for itself whether it belongs on the page. Its endpoint is
 * Super-Admin-only, so if the caller had to remember to gate it, forgetting
 * would put a 403 in everybody else's console on every dashboard load.
 */
export function ApprovalsCard() {
  // Asked of everybody: the server answers with `canAccess` rather than
  // refusing, so a department head — who holds no permission that would mark
  // them out here — gets the card, and everybody else quietly does not.
  const { data, isLoading } = useApprovalSummary();

  const waiting = data?.byModule.filter((m) => m.count > 0) ?? [];
  const staleDays = data?.staleAfterDays ?? 7;

  if (!data?.canAccess) return null;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Waiting on you</h3>
        </div>
        <Link href="/approvals" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          Open console <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Counting…</p>
      ) : !data?.total ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          Nothing is waiting — every request has been dealt with.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-3xl font-bold tabular-nums tracking-tight">{data.total}</span>
            {/* Only worth saying where there is more than one — for a head or
                for HR it is always their own, and naming it adds nothing. */}
            {data.organizations > 1 && (
              <span className="text-sm text-muted-foreground">
                across {data.organizations} organisations
              </span>
            )}
          </div>

          {/* The oldest thing in the queue, said in days. A total on its own
              cannot distinguish a busy morning from a month of neglect. */}
          {data.oldestRaisedAt && (
            <p className={cn(
              "mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium",
              data.stale ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
            )}>
              {data.stale ? <AlertTriangle className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />}
              {data.stale
                ? `${data.stale} waiting over ${staleDays} days — longest ${waitingFor(data.oldestRaisedAt)}`
                : `Longest waiting ${waitingFor(data.oldestRaisedAt)}`}
            </p>
          )}

          <div className="mt-4 space-y-1.5">
            {waiting.map((m) => (
              <Link
                key={m.module}
                href={`/approvals?module=${m.module}`}
                className="flex items-center gap-3 rounded-lg border border-border p-2.5 transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", MODULE_TONE[m.module as ApprovalModule])}>
                  {m.label}
                </span>
                {m.stale > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3" />{m.stale} overdue
                  </span>
                )}
                <span className="ml-auto text-sm font-semibold tabular-nums">{m.count}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
