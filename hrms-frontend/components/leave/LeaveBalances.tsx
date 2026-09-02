"use client";
import { useState } from "react";
import { Plus, Pencil, Trash2, Loader2, Wallet, Settings2 } from "lucide-react";
import { useLeavePolicies, useDeleteLeavePolicy, useMyLeaveBalances } from "@/hooks/useLeaveBalances";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LeavePolicyDialog } from "@/components/leave/LeavePolicyDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { cn } from "@/lib/utils";
import { LEAVE_TYPE_LABELS, type LeavePolicy, leaveTypeLabel } from "@/types";


interface Props {
  /** Whether the caller can manage policies (leave.edit / leave.create). */
  canManage: boolean;
}

/** "3 months" / "1 year" / "18 months" — whole years read better as years. */
function monthsLabel(months: number): string {
  if (months >= 12 && months % 12 === 0) {
    const y = months / 12;
    return `${y} year${y === 1 ? "" : "s"}`;
  }
  return `${months} month${months === 1 ? "" : "s"}`;
}

const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

/**
 * Who a policy covers, in the words the form used to write it.
 *
 * Work mode is checked first because that is the order the resolver applies
 * them in — a policy carrying both would be reported by whichever wins, not by
 * whichever is listed first here.
 */
function policyTarget(p: LeavePolicy): string {
  if (p.workMode) return p.workMode === "wfh" ? "All work-from-home staff" : "All office staff";
  if (p.workSchedule && typeof p.workSchedule === "object") return p.workSchedule.name;
  return "All employees";
}

export function LeaveBalances({ canManage }: Props) {
  const { data: policies, isLoading: policiesLoading } = useLeavePolicies(canManage);
  const { data: balances, isLoading: balancesLoading } = useMyLeaveBalances();
  const { mutate: removePolicy, isPending: deleting } = useDeleteLeavePolicy();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<LeavePolicy | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LeavePolicy | null>(null);

  // A type can now hold several policies — one per work schedule, plus an
  // organization-wide one — so "all configured" is only true when every type is
  // taken org-wide AND on every schedule. The dialog works the rest out.
  const allPolicies = policies ?? [];

  return (
    <div className="space-y-4">
      {canManage && (
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Leave Policies</h3></div>
            <Button size="sm" variant="outline" className="h-8" onClick={() => { setSelected(null); setDialogOpen(true); }}>
              <Plus className="h-3.5 w-3.5" />Add Policy
            </Button>
          </div>
          {policiesLoading ? (
            <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !policies?.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No leave policies configured yet — balances will show entitlement 0 for every type.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {policies.map((p) => (
                <div key={p._id} className="group flex items-start justify-between gap-2 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {p.label?.trim() || leaveTypeLabel(p.type)}
                      {!p.paid && <span className="ml-1.5 text-[11px] font-normal text-amber-600">unpaid</span>}
                    </p>
                    <p className="text-[11px] font-medium text-primary">{policyTarget(p)}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.days}d {p.period === "month" ? "a month" : "a year"}
                      {p.eligibleAfterMonths > 0 && ` · after ${monthsLabel(p.eligibleAfterMonths)}`}
                    </p>
                    {p.carryForwardLimit > 0 && <p className="text-xs text-muted-foreground">Carries up to {p.carryForwardLimit}d forward</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setSelected(p); setDialogOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(p)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2"><Wallet className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">My Leave Balance · {new Date().getFullYear()}</h3></div>
        {balancesLoading ? (
          <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !balances?.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No leave policies configured for your organisation yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {balances.map((b) => (
              <div key={b.type} className="rounded-xl border border-border p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {b.label || leaveTypeLabel(b.type)}
                  {!b.paid && <span className="ml-1.5 normal-case text-amber-600">unpaid</span>}
                </p>
                <p className={cn("mt-1 text-2xl font-bold tabular-nums", b.balance < 0 ? "text-red-500" : "text-primary")}>{b.balance}<span className="ml-1 text-sm font-normal text-muted-foreground">days left</span></p>
                <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {/* Says which window the figures below cover — a monthly
                      allowance resets, a yearly one runs to December. */}
                  <div className="flex justify-between"><span>Allowance</span><span className="tabular-nums">{b.days}d {b.period === "month" ? "a month" : "a year"}</span></div>
                  <div className="flex justify-between"><span>{b.period === "month" ? "This month" : "Granted"}</span><span className="tabular-nums">{b.accrued}</span></div>
                  {b.carriedForward > 0 && <div className="flex justify-between"><span>Carried forward</span><span className="tabular-nums">+{b.carriedForward}</span></div>}
                  <div className="flex justify-between"><span>Used</span><span className="tabular-nums">−{b.used}</span></div>
                </div>
                {/* A zero with no explanation is what sends people to support. */}
                {!b.eligible && b.eligibleOn && (
                  <p className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
                    Opens up after {monthsLabel(b.eligibleAfterMonths)} of service — from {fmtDay(b.eligibleOn)}.
                  </p>
                )}
                {b.joiningDateMissing && b.eligibleAfterMonths > 0 && (
                  <p className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
                    Needs {monthsLabel(b.eligibleAfterMonths)} of service, but this employee has no joining date on record — granted for now.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {canManage && (
        <>
          <LeavePolicyDialog open={dialogOpen} onOpenChange={setDialogOpen} policy={selected} policies={allPolicies} />
          <ConfirmDialog
            open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
            title="Delete leave policy" description="Employees will no longer accrue or see a balance for this leave type." isPending={deleting}
            onConfirm={() => deleteTarget && removePolicy(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) })}
          />
        </>
      )}
    </div>
  );
}
