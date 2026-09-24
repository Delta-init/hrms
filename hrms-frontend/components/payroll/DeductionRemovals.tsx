"use client";
import { useState } from "react";
import {
  Ban, Check, Clock, Landmark, ListChecks, Loader2, Receipt, ShieldCheck, Undo2,
} from "lucide-react";
import {
  useEligibleDeductions, useMyDeductionRemovals, useDeductionRemovalQueue,
  useRequestDeductionRemoval, useReviewDeductionRemoval, useWithdrawDeductionRemoval,
} from "@/hooks/useDeductionRemovals";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs } from "@/components/shared/Tabs";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import { DEDUCTION_REMOVAL_STATUS_LABELS, type DeductionRemovalRequest, type DeductionRemovalStatus, type EligibleDeduction } from "@/types";

const curMonth = () => new Date().toISOString().slice(0, 7);
const nameOf = (v: unknown) => (v && typeof v === "object" ? String((v as { name?: string }).name ?? "") : "");
const when = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_TONE: Record<DeductionRemovalStatus, string> = {
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  rejected: "bg-red-500/10 text-red-600 border-red-500/20",
};

/**
 * Payroll's own deduction-removal requests: an employee asking that a loan
 * instalment or a one-time deduction not be taken from an upcoming month,
 * and the panel that decides it.
 *
 * The self-service half needs no permission — the person it would deduct
 * from is the one asking — exactly like leave and office keeping. `approve`
 * gates the panel underneath it.
 */
export function DeductionRemovals() {
  const { hasPermission } = useAuth();
  const canApprove = hasPermission("deductionRemovals", "approve");

  const [tab, setTab] = useState("mine");
  const tabs = [
    { key: "mine", label: "My Requests", icon: Receipt },
    canApprove && { key: "queue", label: "Panel", icon: ShieldCheck },
  ].filter(Boolean) as { key: string; label: string; icon: React.ElementType }[];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "mine";

  return (
    <div>
      <Tabs tabs={tabs} value={activeTab} onChange={setTab} />
      {activeTab === "mine" && <MyDeductions />}
      {activeTab === "queue" && canApprove && <Queue />}
    </div>
  );
}

function RequestRow({ item, onAsk }: { item: EligibleDeduction; onAsk: (item: EligibleDeduction) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{item.label}</p>
        <p className="text-xs text-muted-foreground">{item.sourceType === "loan" ? "Loan instalment" : "One-time deduction"}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="tabular-nums text-sm font-semibold">{money(item.amount)}</span>
        {item.alreadyRequested ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-600">
            <Clock className="h-3 w-3" />Requested
          </span>
        ) : (
          <Button size="sm" variant="outline" onClick={() => onAsk(item)}>Request removal</Button>
        )}
      </div>
    </div>
  );
}

function MyDeductions() {
  const [month, setMonth] = useState(curMonth());
  const { data: eligible, isLoading } = useEligibleDeductions(month);
  const { data: mine, isLoading: mineLoading } = useMyDeductionRemovals({ limit: "50" });
  const { mutate: request, isPending: requesting } = useRequestDeductionRemoval();
  const { mutate: withdraw, isPending: withdrawing } = useWithdrawDeductionRemoval();

  const [asking, setAsking] = useState<EligibleDeduction | null>(null);
  const [reason, setReason] = useState("");
  const [withdrawTarget, setWithdrawTarget] = useState<DeductionRemovalRequest | null>(null);

  const items = eligible?.items ?? [];
  const requests = mine?.data ?? [];

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Deductions due this month</p>
            <p className="text-xs text-muted-foreground">Ask that one not be taken — HR decides before it&rsquo;s collected.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="drmonth" className="text-xs text-muted-foreground">Month</Label>
            <Input id="drmonth" type="month" className="h-9 w-[150px]" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !eligible?.editable ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {month} is no longer open for changes.
          </p>
        ) : items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nothing due for {month} that could be asked to be removed.
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <RequestRow key={`${item.sourceType}:${item.sourceId}`} item={item} onAsk={(i) => { setAsking(i); setReason(""); }} />
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <p className="mb-3 text-sm font-medium">Your requests</p>
        {mineLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : requests.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">You haven&rsquo;t asked for anything yet.</p>
        ) : (
          <div className="space-y-2">
            {requests.map((r) => (
              <div key={r._id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", STATUS_TONE[r.status])}>
                      {DEDUCTION_REMOVAL_STATUS_LABELS[r.status]}
                    </span>
                    <span className="text-sm font-medium">{r.sourceLabel}</span>
                    <span className="text-xs text-muted-foreground">{r.month} · {money(r.amount)}</span>
                  </div>
                  {r.status === "pending" && (
                    <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs text-muted-foreground" onClick={() => setWithdrawTarget(r)}>
                      <Undo2 className="h-3.5 w-3.5" />Withdraw
                    </Button>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{r.reason}</p>
                {r.reviewNote && <p className="mt-1 text-xs italic text-muted-foreground">HR: {r.reviewNote}</p>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <ResponsiveDialog open={!!asking} onOpenChange={(o) => !o && setAsking(null)}>
        <ResponsiveDialogContent desktopClassName="max-w-md">
          <ResponsiveDialogHeader><ResponsiveDialogTitle>Request removal</ResponsiveDialogTitle></ResponsiveDialogHeader>
          <div className="space-y-3 px-4 sm:px-0">
            {asking && (
              <div className="rounded-lg bg-muted/40 p-3 text-sm">
                <p className="font-medium">{asking.label}</p>
                <p className="text-xs text-muted-foreground">{month} · {money(asking.amount)}</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="drreason">Why? *</Label>
              <Textarea id="drreason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What's the situation?" />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setAsking(null)}>Cancel</Button>
            <Button
              disabled={!reason.trim() || requesting}
              onClick={() => asking && request(
                { sourceType: asking.sourceType, sourceId: asking.sourceId, month, reason: reason.trim() },
                { onSuccess: () => setAsking(null) }
              )}
            >
              {requesting && <Loader2 className="h-4 w-4 animate-spin" />}Send request
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ConfirmDialog
        open={!!withdrawTarget} onOpenChange={(o) => !o && setWithdrawTarget(null)}
        title="Withdraw this request" description="You can always ask again." confirmLabel="Withdraw" isPending={withdrawing}
        onConfirm={() => withdrawTarget && withdraw(withdrawTarget._id, { onSuccess: () => setWithdrawTarget(null) })}
      />
    </div>
  );
}

function Queue() {
  const [status, setStatus] = useState("pending");
  const { data, isLoading } = useDeductionRemovalQueue({ status, limit: "200" });
  const { mutate: review, isPending: reviewing } = useReviewDeductionRemoval();
  const [note, setNote] = useState<Record<string, string>>({});
  const requests = data?.data ?? [];

  return (
    <div className="space-y-3">
      <Card className="flex items-center gap-2 p-3">
        {(["pending", "approved", "rejected"] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={cn("rounded-full px-3 py-1 text-xs font-medium transition", status === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
            {DEDUCTION_REMOVAL_STATUS_LABELS[s]}
          </button>
        ))}
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : requests.length === 0 ? (
        <Card className="p-16 text-center text-muted-foreground"><ListChecks className="mx-auto mb-2 h-7 w-7" />Nothing here.</Card>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <Card key={r._id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", STATUS_TONE[r.status])}>
                      {DEDUCTION_REMOVAL_STATUS_LABELS[r.status]}
                    </span>
                    <span className="inline-flex items-center gap-1 text-sm font-medium"><Landmark className="h-3.5 w-3.5 text-muted-foreground" />{r.sourceLabel}</span>
                  </div>
                  <p className="mt-1.5 text-sm">{r.reason}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {nameOf(r.employee) || "—"} · {r.month} · {money(r.amount)} · asked {when(r.createdAt)}
                    {r.reviewNote ? ` · ${r.reviewNote}` : ""}
                  </p>
                </div>
              </div>
              {r.status === "pending" && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                  <Input
                    className="h-8 max-w-xs" placeholder="Note (optional)"
                    value={note[r._id] ?? ""} onChange={(e) => setNote((s) => ({ ...s, [r._id]: e.target.value }))}
                  />
                  <Button size="sm" variant="outline" className="text-emerald-600" disabled={reviewing}
                    onClick={() => review({ id: r._id, status: "approved", reviewNote: note[r._id] })}>
                    <Check className="h-3.5 w-3.5" />Approve
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive" disabled={reviewing}
                    onClick={() => review({ id: r._id, status: "rejected", reviewNote: note[r._id] })}>
                    <Ban className="h-3.5 w-3.5" />Reject
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
