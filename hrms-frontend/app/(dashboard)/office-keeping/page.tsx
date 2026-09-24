"use client";
import { useState } from "react";
import { Sparkles, Plus, Loader2, MapPin, Clock, Undo2, Truck, CheckCircle2, ListChecks, Inbox } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { PhotoViewer } from "@/components/shared/PhotoViewer";
import { RaiseRequestDialog } from "@/components/office-keeping/RaiseRequestDialog";
import { useAuth } from "@/hooks/useAuth";
import {
  useMyOfficeKeeping, useOfficeKeepingQueue, useSetOfficeKeepingStatus, useWithdrawOfficeKeeping,
} from "@/hooks/useOfficeKeeping";
import { cn } from "@/lib/utils";
import {
  OFFICE_KEEPING_STATUS_LABELS, type OfficeKeepingRequest, type OfficeKeepingStatus,
} from "@/types";

const ALL = "__all__";
const tone: Record<OfficeKeepingStatus, string> = {
  requested: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  arriving: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  sorted: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  cancelled: "bg-muted text-muted-foreground border-border",
};
const nameOf = (v: unknown) => (v && typeof v === "object" ? String((v as { name?: string }).name ?? "") : "");
const when = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function RequestCard({ r, children }: { r: OfficeKeepingRequest; children?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", tone[r.status])}>
              {OFFICE_KEEPING_STATUS_LABELS[r.status]}
            </span>
            <span className="inline-flex items-center gap-1 text-sm font-medium"><MapPin className="h-3.5 w-3.5 text-muted-foreground" />{r.location}</span>
          </div>
          <p className="mt-1.5 text-sm">{r.issue}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {nameOf(r.requestedBy) || "—"} · {when(r.createdAt)}
            {r.handledBy ? ` · handled by ${nameOf(r.handledBy)}` : ""}
          </p>
        </div>
        {r.photoUrl && <PhotoViewer src={r.photoUrl} caption={r.location} alt={r.issue} />}
      </div>

      {/* The trail: when somebody set off, and when it was done. */}
      {r.history.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
          {r.history.map((h, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {OFFICE_KEEPING_STATUS_LABELS[h.status]} · {when(h.at)}
              {h.note ? ` — ${h.note}` : ""}
            </span>
          ))}
        </div>
      )}
      {children && <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">{children}</div>}
    </Card>
  );
}

export default function OfficeKeepingPage() {
  const { hasPermission } = useAuth();
  const canWorkQueue = hasPermission("officeKeeping", "approve");

  const [tab, setTab] = useState("mine");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [status, setStatus] = useState(ALL);
  const [note, setNote] = useState<Record<string, string>>({});
  const [withdrawTarget, setWithdrawTarget] = useState<OfficeKeepingRequest | null>(null);

  const tabs = [
    { key: "mine", label: "My Requests", icon: Inbox },
    canWorkQueue && { key: "queue", label: "Panel", icon: ListChecks },
  ].filter(Boolean) as { key: string; label: string; icon: React.ElementType }[];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "mine";

  const { data: mine, isLoading: mineLoading } = useMyOfficeKeeping();
  const { data: queue, isLoading: queueLoading } = useOfficeKeepingQueue(
    status !== ALL ? { status, limit: "200" } : { limit: "200" },
    canWorkQueue && activeTab === "queue"
  );
  const { mutate: setStatusFor, isPending: saving } = useSetOfficeKeepingStatus();
  const { mutate: withdraw, isPending: withdrawing } = useWithdrawOfficeKeeping();

  return (
    <div>
      <PageHeader
        title="Office Keeping"
        description="Something broken, missing or needing a clean? Say so here."
        icon={Sparkles}
        action={<Button className="shadow-sm" onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4" />New request</Button>}
      />

      <Tabs tabs={tabs} value={activeTab} onChange={setTab} />

      {activeTab === "mine" && (
        mineLoading ? (
          <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !mine?.data.length ? (
          <Card className="p-16 text-center text-muted-foreground">You have not asked for anything yet.</Card>
        ) : (
          <div className="space-y-3">
            {mine.data.map((r) => (
              <RequestCard key={r._id} r={r}>
                {r.status === "requested" && (
                  <Button size="sm" variant="outline" onClick={() => setWithdrawTarget(r)}>
                    <Undo2 className="h-3.5 w-3.5" />Withdraw
                  </Button>
                )}
              </RequestCard>
            ))}
          </div>
        )
      )}

      {activeTab === "queue" && canWorkQueue && (
        <>
          <Card className="mb-3 flex items-center gap-3 p-3">
            <span className="text-sm text-muted-foreground">Show</span>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Everything</SelectItem>
                {(Object.keys(OFFICE_KEEPING_STATUS_LABELS) as OfficeKeepingStatus[]).map((s) => (
                  <SelectItem key={s} value={s}>{OFFICE_KEEPING_STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Card>

          {queueLoading ? (
            <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : !queue?.data.length ? (
            <Card className="p-16 text-center text-muted-foreground">Nothing here.</Card>
          ) : (
            <div className="space-y-3">
              {queue.data.map((r) => (
                <RequestCard key={r._id} r={r}>
                  {(r.status === "requested" || r.status === "arriving") ? (
                    <>
                      <Input
                        className="h-8 max-w-xs"
                        placeholder="Note — sent to whoever asked"
                        value={note[r._id] ?? ""}
                        onChange={(e) => setNote((s) => ({ ...s, [r._id]: e.target.value }))}
                      />
                      {r.status === "requested" && (
                        <Button size="sm" variant="outline" disabled={saving}
                          onClick={() => setStatusFor({ id: r._id, status: "arriving", note: note[r._id] })}>
                          <Truck className="h-3.5 w-3.5" />On the way
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="text-emerald-600" disabled={saving}
                        onClick={() => setStatusFor({ id: r._id, status: "sorted", note: note[r._id] })}>
                        <CheckCircle2 className="h-3.5 w-3.5" />Sorted
                      </Button>
                      <Button size="sm" variant="outline" className="text-muted-foreground" disabled={saving}
                        onClick={() => setStatusFor({ id: r._id, status: "cancelled", note: note[r._id] })}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">Closed — nothing left to do.</span>
                  )}
                </RequestCard>
              ))}
            </div>
          )}
        </>
      )}

      <RaiseRequestDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <ConfirmDialog
        open={!!withdrawTarget} onOpenChange={(o) => !o && setWithdrawTarget(null)}
        title="Withdraw this request" description="It disappears from office keeping's list. You can always raise it again."
        confirmLabel="Withdraw" isPending={withdrawing}
        onConfirm={() => withdrawTarget && withdraw(withdrawTarget._id, { onSuccess: () => setWithdrawTarget(null) })}
      />
    </div>
  );
}
