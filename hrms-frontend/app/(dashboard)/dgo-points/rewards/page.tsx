"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive, Check, ClipboardList, Coins, FileSpreadsheet, Gift, History, Inbox, Loader2, PackageCheck, Pencil, Plus, Save,
  ShoppingBag, Store, Truck, X,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogDescription, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  useDgoRewards, useDgoRedemptions, useRedeemDgoReward, useDgoRedemptionStep, useSaveDgoReward, useArchiveDgoReward,
  useImportDgoRewards,
  newRequestId, dgoAed, formatAed, formatPoints, dgoErrorMessage,
} from "@/hooks/useDgoPoints";
import {
  DgoFileUpload, DgoGate, NoteDialog, Notice, PurchasePill, RedemptionPill, Spinner, TableWrap, actionLabel, dateTime,
} from "@/components/dgo/shared";
import { readRewardRows, readSheet, type ImportRow } from "@/lib/dgoRewardImport";
import type { DgoMe, DgoRedemption, DgoRedemptionsTab, DgoReward, DgoRewardsView, DgoUpload } from "@/types";

type Tab = "store" | "mine" | "fulfilment" | "catalogue";
const TABS: Tab[] = ["store", "mine", "fulfilment", "catalogue"];

export default function DgoRewardsPage() {
  // useSearchParams needs a boundary or the whole page opts out of static rendering.
  return (
    <Suspense fallback={<Spinner />}>
      <DgoGate allow={(me) => me.canUse}>
        {(me) => <RewardsPage me={me} />}
      </DgoGate>
    </Suspense>
  );
}

function RewardsPage({ me }: { me: DgoMe }) {
  const router = useRouter();
  const params = useSearchParams();
  const canFulfilView = !!me.can.rewardsView || !!me.can.rewardsFulfil;
  const canManage = !!me.can.rewardsManage;
  const allowed = (t: Tab) => (t === "fulfilment" ? canFulfilView : t === "catalogue" ? canManage : true);
  const asked = params.get("tab") as Tab | null;
  const tab: Tab = asked && TABS.includes(asked) && allowed(asked) ? asked : "store";
  const setTab = (t: Tab) => router.replace(t === "store" ? "/dgo-points/rewards" : `/dgo-points/rewards?tab=${t}`, { scroll: false });

  return (
    <div>
      <PageHeader
        title="Rewards"
        description="Spend your points on rewards. Points are held when you ask, and spent when HR hands the reward over."
        icon={Gift}
      />
      <Tabs
        layoutId="dgo-rewards-tabs"
        value={tab}
        onChange={(k) => setTab(k as Tab)}
        tabs={[
          { key: "store", label: "Store", icon: Store },
          { key: "mine", label: "My redemptions", icon: ShoppingBag },
          ...(canFulfilView ? [{ key: "fulfilment", label: "Fulfilment", icon: Truck }] : []),
          ...(canManage ? [{ key: "catalogue", label: "Catalogue", icon: ClipboardList }] : []),
        ]}
      />
      {tab === "store" ? <StoreTab me={me} onRedeemed={() => setTab("mine")} />
        : tab === "mine" ? <MineTab />
          : tab === "fulfilment" ? <FulfilmentTab me={me} />
            : <CatalogueTab me={me} />}
    </div>
  );
}

// ─── Store ────────────────────────────────────────────────────────────────────

function StoreTab({ me, onRedeemed }: { me: DgoMe; onRedeemed: () => void }) {
  const { data, isLoading, isFetching, error } = useDgoRewards(false);
  const [category, setCategory] = useState("");
  const [redeeming, setRedeeming] = useState<DgoReward | null>(null);

  if (isLoading) return <Spinner />;
  if (error || !data) return <Notice text={dgoErrorMessage(error, "The store couldn't be loaded. Try again in a moment.")} />;
  const shown = category ? data.rewards.filter((r) => r.category === category) : data.rewards;

  return (
    <div className="space-y-5">
      <Card className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10"><Coins className="h-5 w-5 text-amber-600 dark:text-amber-400" /></span>
          <div>
            <p className="text-xs text-muted-foreground">You can spend</p>
            <p className="text-xl font-bold tabular-nums">{formatPoints(data.available)} pts <span className="text-sm font-normal text-muted-foreground">= {formatAed(dgoAed(data.available, data.pointValueAed))}</span></p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground sm:max-w-xs sm:text-right">
          Rewards start at {formatPoints(data.minRedemption)} points. Points you spend come from the ones that expire first.
        </p>
      </Card>

      {!me.employee && <Notice text="Your login isn't linked to an employee record, so you have no points to spend." />}

      {data.categories.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          {["", ...data.categories].map((c) => (
            <button
              key={c || "all"}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                category === c ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {c || "All"}
            </button>
          ))}
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      )}

      {shown.length === 0 ? (
        <Notice icon={Gift} text={data.rewards.length ? "Nothing in this category right now." : "The store is empty for now. HR is adding rewards — check back soon."} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((r) => <RewardCard key={r.id} reward={r} canSpend={!!me.employee} onRedeem={() => setRedeeming(r)} />)}
        </div>
      )}

      <RedeemDialog reward={redeeming} data={data} onOpenChange={(o) => !o && setRedeeming(null)} onDone={onRedeemed} />
    </div>
  );
}

const outOfStock = (r: DgoReward) => r.stockMode === "limited" && (r.stock ?? 0) <= 0;

function RewardPhoto({ reward, className }: { reward: Pick<DgoReward, "photoUrl" | "name">; className?: string }) {
  // A photo link lasts an hour; one that fails (expired, or gone from storage) falls back to the gift icon.
  const [broken, setBroken] = useState<string | null>(null);
  return reward.photoUrl && broken !== reward.photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={reward.photoUrl} alt={reward.name} className={cn("object-cover", className)} onError={() => setBroken(reward.photoUrl)} />
  ) : (
    <div className={cn("flex items-center justify-center bg-gradient-to-br from-amber-500/15 to-primary/10", className)}>
      <Gift className="h-8 w-8 text-amber-600/70 dark:text-amber-400/70" />
    </div>
  );
}

function RewardCard({ reward: r, canSpend, onRedeem }: { reward: DgoReward; canSpend: boolean; onRedeem: () => void }) {
  const gone = outOfStock(r);
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="relative">
        <RewardPhoto reward={r} className="aspect-[4/3] w-full" />
        <span className="absolute left-2 top-2 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium shadow-sm">{r.category}</span>
        {r.stockMode === "limited" && !gone && (r.stock ?? 0) <= 5 && (
          <span className="absolute right-2 top-2 rounded-full bg-orange-500 px-2 py-0.5 text-[11px] font-semibold text-white">Only {r.stock} left</span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="font-semibold leading-snug">{r.name}</p>
        {r.description && <p className="line-clamp-3 text-sm text-muted-foreground">{r.description}</p>}
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div>
            <p className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">{formatPoints(r.points)} pts</p>
            <p className="text-xs text-muted-foreground">worth {formatAed(r.aed)}</p>
          </div>
          {gone ? (
            <Button size="sm" variant="outline" disabled>Out of stock</Button>
          ) : !canSpend ? null : r.affordable ? (
            <Button size="sm" onClick={onRedeem}><ShoppingBag className="h-4 w-4" /> Redeem</Button>
          ) : (
            <Button size="sm" variant="outline" disabled title="Earn more points to get this">You need {formatPoints(r.short)} more</Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function RedeemDialog({
  reward, data, onOpenChange, onDone,
}: {
  reward: DgoReward | null;
  data: DgoRewardsView;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const redeem = useRedeemDgoReward();
  const [note, setNote] = useState("");
  const [requestId, setRequestId] = useState(newRequestId);
  useEffect(() => {
    if (!reward) return;
    setNote("");
    setRequestId(newRequestId());
  }, [reward]);
  const after = reward ? data.available - reward.points : 0;

  return (
    <ResponsiveDialog open={!!reward} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Redeem this reward</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
            These points are held until HR approves. You can cancel until then and get them back.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {reward && (
          <div className="space-y-4 px-4 sm:px-0">
            <div className="flex items-center gap-3 rounded-lg border border-border p-3">
              <RewardPhoto reward={reward} className="h-16 w-16 shrink-0 rounded-md" />
              <div className="min-w-0">
                <p className="font-semibold">{reward.name}</p>
                <p className="text-sm text-muted-foreground">{reward.category}</p>
                <p className="text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400">{formatPoints(reward.points)} pts</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg bg-muted/60 p-2.5"><p className="text-xs text-muted-foreground">You have</p><p className="font-semibold tabular-nums">{formatPoints(data.available)} pts</p></div>
              <div className="rounded-lg bg-muted/60 p-2.5"><p className="text-xs text-muted-foreground">Left after</p><p className="font-semibold tabular-nums">{formatPoints(Math.max(0, after))} pts</p></div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dgo-redeem-note">Anything HR should know? (optional)</Label>
              <Textarea id="dgo-redeem-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Size, colour, where to deliver…" />
            </div>
          </div>
        )}
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={redeem.isPending}>Cancel</Button>
          <Button
            disabled={!reward || after < 0 || redeem.isPending}
            onClick={() => reward && redeem.mutate(
              { rewardId: reward.id, ...(note.trim() ? { note: note.trim() } : {}), requestId },
              { onSuccess: () => { onOpenChange(false); onDone(); } },
            )}
          >
            {redeem.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />}
            Hold {reward ? formatPoints(reward.points) : ""} points
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

// ─── Redemptions (mine and fulfilment share the card) ─────────────────────────

type Step = "cancel" | "approve" | "reject" | "fulfil";

function useStepDialog() {
  const step = useDgoRedemptionStep();
  const [intent, setIntent] = useState<{ r: DgoRedemption; step: Step } | null>(null);
  const run = (note: string) => {
    if (!intent) return;
    step.mutate({ id: intent.r.id, step: intent.step, ...(note ? { note } : {}) }, { onSuccess: () => setIntent(null) });
  };
  const dialog = (
    <>
      <ConfirmDialog
        open={intent?.step === "cancel"}
        onOpenChange={(o) => !o && setIntent(null)}
        title="Cancel this request?"
        description={intent ? `${formatPoints(intent.r.points)} points held for "${intent.r.reward.name}" come back to you straight away.` : undefined}
        confirmLabel="Cancel request"
        isPending={step.isPending}
        onConfirm={() => run("")}
      />
      <NoteDialog
        open={!!intent && intent.step !== "cancel"}
        onOpenChange={(o) => !o && setIntent(null)}
        title={intent?.step === "approve" ? "Approve this reward" : intent?.step === "reject" ? "Reject this reward" : "Mark as delivered"}
        description={
          !intent ? undefined
            : intent.step === "approve" ? `${intent.r.employee.name} — "${intent.r.reward.name}". The points stay held until you mark it delivered. If this reward is bought each time, a purchase request goes to finance.`
              : intent.step === "reject" ? `${formatPoints(intent.r.points)} held points go back to ${intent.r.employee.name}. They see your reason.`
                : `${formatPoints(intent.r.points)} held points are spent. This can't be undone.`
        }
        noteLabel={intent?.step === "reject" ? "Reason" : intent?.step === "fulfil" ? "How it was handed over (optional)" : "Note (optional)"}
        placeholder={intent?.step === "fulfil" ? "Supplier reference, voucher code sent, handed over in person…" : undefined}
        requireNote={intent?.step === "reject"}
        confirmLabel={intent?.step === "approve" ? "Approve" : intent?.step === "reject" ? "Reject" : "Mark delivered"}
        tone={intent?.step === "reject" ? "danger" : "good"}
        icon={intent?.step === "approve" ? Check : intent?.step === "reject" ? X : PackageCheck}
        isPending={step.isPending}
        onConfirm={run}
      />
    </>
  );
  return { open: (r: DgoRedemption, s: Step) => setIntent({ r, step: s }), busyId: step.isPending ? step.variables?.id : undefined, dialog };
}

function RedemptionCard({
  r, showEmployee, onStep, busy,
}: {
  r: DgoRedemption;
  showEmployee: boolean;
  onStep: (s: Step) => void;
  busy: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <RewardPhoto reward={{ photoUrl: r.reward.photoUrl, name: r.reward.name }} className="h-16 w-16 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{r.reward.name}</p>
            <RedemptionPill status={r.status} />
            {showEmployee && r.purchase && r.purchase.status !== "not_needed" && <PurchasePill purchase={r.purchase} />}
          </div>
          {!showEmployee && r.purchase?.status === "waiting_finance" && (r.status === "approved" || r.status === "reserved") && (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Waiting for finance to approve the purchase</p>
          )}
          {showEmployee && (
            <p className="text-sm">{r.employee.name}{r.employee.department && <span className="text-muted-foreground"> · {r.employee.department}</span>}</p>
          )}
          <p className="text-xs text-muted-foreground">{r.reward.category} · asked {dateTime(r.createdAt)}</p>
          {r.note && <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-xs"><span className="font-medium">Note:</span> {r.note}</p>}
          {r.fulfilmentNote && <p className="rounded-md bg-emerald-500/10 px-2.5 py-1.5 text-xs"><span className="font-medium">Handed over:</span> {r.fulfilmentNote}</p>}
          {r.trail.length > 0 && (
            <ul className="space-y-0.5 pt-1 text-xs text-muted-foreground">
              {r.trail.map((t, i) => (
                <li key={i}>
                  {dateTime(t.at)} · <span className="font-medium text-foreground">{actionLabel(t.action)}</span>
                  {t.byName ? ` by ${t.byName}` : ""}{t.note ? `: ${t.note}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <div className="sm:text-right">
            <p className="text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">{formatPoints(r.points)} pts</p>
            <p className="text-xs text-muted-foreground">worth {formatAed(r.aed)}{r.costAed != null ? ` · costs ${formatAed(r.costAed)}` : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {r.canCancel && <Button size="sm" variant="outline" disabled={busy} onClick={() => onStep("cancel")}><X className="h-4 w-4" /> Cancel</Button>}
            {r.canReject && <Button size="sm" variant="outline" className="text-red-600 hover:text-red-700" disabled={busy} onClick={() => onStep("reject")}><X className="h-4 w-4" /> Reject</Button>}
            {r.canApprove && <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={() => onStep("approve")}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve</Button>}
            {r.canFulfil && <Button size="sm" disabled={busy} onClick={() => onStep("fulfil")}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Mark delivered</Button>}
          </div>
          {r.whyNot && <p className="text-xs text-muted-foreground sm:text-right">{r.whyNot}</p>}
        </div>
      </div>
    </Card>
  );
}

function RedemptionList({ tab, showEmployee, empty }: { tab: DgoRedemptionsTab; showEmployee: boolean; empty: string }) {
  const { data, isLoading, isFetching, error } = useDgoRedemptions(tab);
  const steps = useStepDialog();
  if (isLoading) return <Spinner />;
  if (error || !data) return <Notice text={dgoErrorMessage(error, "These couldn't be loaded. Try again in a moment.")} />;
  return (
    <div className="space-y-3">
      {isFetching && <div className="flex justify-end"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
      {data.items.length === 0 ? (
        <Notice icon={Inbox} text={empty} />
      ) : (
        data.items.map((r) => (
          <RedemptionCard key={r.id} r={r} showEmployee={showEmployee} busy={steps.busyId === r.id} onStep={(s) => steps.open(r, s)} />
        ))
      )}
      {steps.dialog}
    </div>
  );
}

function MineTab() {
  return <RedemptionList tab="mine" showEmployee={false} empty="You haven't redeemed anything yet. Pick something in the Store." />;
}

function FulfilmentTab({ me }: { me: DgoMe }) {
  const [sub, setSub] = useState<"queue" | "done">("queue");
  const { data } = useDgoRedemptions(sub);
  return (
    <div>
      <Tabs
        layoutId="dgo-fulfilment-tabs"
        value={sub}
        onChange={(k) => setSub(k as "queue" | "done")}
        tabs={[
          { key: "queue", label: "To do", icon: Inbox, count: data?.counts.queue },
          { key: "done", label: "Done", icon: History, count: data?.counts.done },
        ]}
      />
      {!me.can.rewardsFulfil && <p className="mb-3 text-xs text-muted-foreground">You can see the queue but not approve or deliver rewards.</p>}
      <RedemptionList
        key={sub}
        tab={sub}
        showEmployee
        empty={sub === "queue" ? "Nothing waiting. New requests show up here." : "Nothing delivered, cancelled or rejected yet."}
      />
    </div>
  );
}

// ─── Catalogue ────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<DgoReward["status"], string> = {
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  hidden: "bg-muted text-muted-foreground",
  archived: "bg-muted text-muted-foreground",
};

function CatalogueTab({ me }: { me: DgoMe }) {
  const { data, isLoading, error } = useDgoRewards(true);
  const archive = useArchiveDgoReward();
  const [editing, setEditing] = useState<DgoReward | "new" | null>(null);
  const [archiving, setArchiving] = useState<DgoReward | null>(null);
  const [importing, setImporting] = useState(false);

  if (isLoading) return <Spinner />;
  if (error || !data) return <Notice text={dgoErrorMessage(error, "The catalogue couldn't be loaded. Try again in a moment.")} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Hidden rewards stay out of the store. Removing one keeps past redemptions as they were.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setImporting(true)}><FileSpreadsheet className="h-4 w-4" /> Import from Excel</Button>
          <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Add reward</Button>
        </div>
      </div>
      {data.rewards.length === 0 ? (
        <Notice icon={Gift} text="No rewards yet. Add the first one." />
      ) : (
        <Card>
          <TableWrap>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Reward</th>
                  <th className="px-4 py-2 text-right font-medium">Points</th>
                  <th className="px-4 py-2 text-right font-medium">Costs us</th>
                  <th className="px-4 py-2 text-right font-medium">Stock</th>
                  <th className="px-4 py-2 text-right font-medium">Redeemed</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rewards.map((r) => (
                  <tr key={r.id} className={cn(r.status !== "active" && "text-muted-foreground")}>
                    <td className="px-4 py-2">
                      <div className="flex min-w-[14rem] items-center gap-3">
                        <RewardPhoto reward={r} className="h-10 w-10 shrink-0 rounded-md" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{r.name}</p>
                          <p className="text-xs text-muted-foreground">{r.category}</p>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatPoints(r.points)}<span className="block text-xs text-muted-foreground">{formatAed(r.aed)}</span></td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                      {r.costAed != null ? formatAed(r.costAed) : "—"}
                      {r.buyPerRedemption && <span className="block text-xs text-muted-foreground">bought each time</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{r.stockMode === "unlimited" ? "No limit" : formatPoints(r.stock ?? 0)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{formatPoints(r.redeemedCount)}</td>
                    <td className="px-4 py-2"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[r.status])}>{r.status === "active" ? "In the store" : r.status === "hidden" ? "Hidden" : "Removed"}</span></td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <Button size="sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" aria-label={`Remove ${r.name}`} onClick={() => setArchiving(r)}><Archive className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      <RewardDialog
        reward={editing === "new" ? null : editing}
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        minRedemption={data.minRedemption}
        pointValueAed={data.pointValueAed || me.pointValueAed}
        categories={data.categories}
      />
      <ImportRewardsDialog
        open={importing}
        onOpenChange={setImporting}
        minRedemption={data.minRedemption}
        pointValueAed={data.pointValueAed || me.pointValueAed}
        existingNames={data.rewards.map((r) => r.name)}
      />
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        title="Remove this reward?"
        description={archiving ? `"${archiving.name}" leaves the store and this list. Requests already made keep their price and carry on.` : undefined}
        confirmLabel="Remove"
        isPending={archive.isPending}
        onConfirm={() => archiving && archive.mutate({ id: archiving.id }, { onSuccess: () => setArchiving(null) })}
      />
    </div>
  );
}

const CATEGORY_SUGGESTIONS = ["Voucher", "Gadget", "Experience", "Time off", "Merchandise", "Other"];
const int = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);

function RewardDialog({
  reward, open, onOpenChange, minRedemption, pointValueAed, categories,
}: {
  reward: DgoReward | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  minRedemption: number;
  pointValueAed: number;
  categories: string[];
}) {
  const save = useSaveDgoReward();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [photo, setPhoto] = useState<DgoUpload | null>(null);
  const [points, setPoints] = useState("");
  const [cost, setCost] = useState("");
  const [stockMode, setStockMode] = useState<"unlimited" | "limited">("unlimited");
  const [stock, setStock] = useState("");
  const [active, setActive] = useState(true);
  // Follows the cost (on when it has one) until somebody flips it by hand.
  const [buy, setBuy] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    setBuy(reward?.buyPerRedemption ?? null);
    setName(reward?.name ?? "");
    setDescription(reward?.description ?? "");
    setCategory(reward?.category ?? "");
    setPhoto(reward?.photoKey ? { key: reward.photoKey, url: reward.photoUrl ?? "", fileName: "Current photo", contentType: "image/*" } : null);
    setPoints(reward ? String(reward.points) : "");
    setCost(reward?.costAed != null ? String(reward.costAed) : "");
    setStockMode(reward?.stockMode ?? "unlimited");
    setStock(reward?.stock != null ? String(reward.stock) : "");
    setActive(reward ? reward.status === "active" : true);
  }, [open, reward]);

  const suggestions = useMemo(() => Array.from(new Set([...categories, ...CATEGORY_SUGGESTIONS])), [categories]);
  const pts = int(points);
  const costNum = cost.trim() ? Number(cost.replace(/,/g, "")) : null;
  const stockNum = int(stock);
  const buyPerRedemption = buy ?? (costNum ?? 0) > 0;
  const problem =
    name.trim().length < 2 ? "Give it a name"
      : category.trim().length < 2 ? "Pick or type a category"
        : !Number.isInteger(pts) ? "The price must be a whole number of points"
          : pts < minRedemption ? `The price must be at least ${formatPoints(minRedemption)} points`
            : costNum !== null && !(costNum >= 0) ? "The cost must be 0 or more"
              : stockMode === "limited" && !Number.isInteger(stockNum) ? "Say how many are in stock"
                : null;

  const submit = () => {
    if (problem) return;
    save.mutate(
      {
        ...(reward ? { id: reward.id } : {}),
        name: name.trim(),
        description: description.trim(),
        category: category.trim(),
        photoKey: photo?.key ?? null,
        points: pts,
        costAed: costNum,
        stockMode,
        stock: stockMode === "limited" ? stockNum : null,
        status: active ? "active" : "hidden",
        buyPerRedemption,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{reward ? "Edit reward" : "Add a reward"}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
            A new price applies to new requests only; requests already made keep the price they were made at.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-4 sm:px-0">
          <div className="space-y-1.5">
            <Label htmlFor="dgo-rw-name">Name</Label>
            <Input id="dgo-rw-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Amazon voucher, AED 100" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dgo-rw-desc">Description (optional)</Label>
            <Textarea id="dgo-rw-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dgo-rw-cat">Category</Label>
            <Input id="dgo-rw-cat" list="dgo-rw-cats" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={40} placeholder="Voucher, Gadget, Experience…" />
            <datalist id="dgo-rw-cats">{suggestions.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="space-y-1.5">
            <Label>Photo (optional)</Label>
            <DgoFileUpload kind="reward" value={photo} onChange={setPhoto} label="Upload a photo" disabled={save.isPending} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="dgo-rw-pts">Price in points</Label>
              <Input id="dgo-rw-pts" inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} placeholder={String(minRedemption)} />
              <p className="text-xs text-muted-foreground">
                {Number.isInteger(pts) ? `Worth ${formatAed(dgoAed(pts, pointValueAed))} to the employee. ` : ""}At least {formatPoints(minRedemption)}.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dgo-rw-cost">What it costs us (AED, optional)</Label>
              <Input id="dgo-rw-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" />
              <p className="text-xs text-muted-foreground">Only HR and finance see this.</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Stock</Label>
              <Select value={stockMode} onValueChange={(v) => setStockMode(v as "unlimited" | "limited")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unlimited">No limit</SelectItem>
                  <SelectItem value="limited">A fixed number</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {stockMode === "limited" && (
              <div className="space-y-1.5">
                <Label htmlFor="dgo-rw-stock">How many in stock</Label>
                <Input id="dgo-rw-stock" inputMode="numeric" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="10" />
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Buy one for each redemption</p>
              <p className="text-xs text-muted-foreground">HR&apos;s approval sends a purchase request to finance. Off for things already in stock or with no cost.</p>
            </div>
            <Switch checked={buyPerRedemption} onCheckedChange={(v) => setBuy(v)} aria-label="Buy one for each redemption" />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Show in the store</p>
              <p className="text-xs text-muted-foreground">Off keeps it hidden until you&apos;re ready.</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} aria-label="Show in the store" />
          </div>
        </div>
        <ResponsiveDialogFooter>
          {problem && <p className="mr-auto self-center text-xs text-muted-foreground">{problem}</p>}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
          <Button onClick={submit} disabled={!!problem || save.isPending}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

// ─── Import from Excel ────────────────────────────────────────────────────────

function ImportRewardsDialog({
  open, onOpenChange, minRedemption, pointValueAed, existingNames,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  minRedemption: number;
  pointValueAed: number;
  existingNames: string[];
}) {
  const save = useImportDgoRewards();
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [inStore, setInStore] = useState(false);
  const [results, setResults] = useState<Array<{ name: string; error: string | null }> | null>(null);

  useEffect(() => {
    if (!open) return;
    setFileName(null); setRows(null); setReadError(null); setInStore(false); setResults(null);
  }, [open]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name); setRows(null); setReadError(null); setResults(null);
    try {
      const read = readRewardRows(await readSheet(file), { minRedemption, pointValueAed, existingNames });
      if (!read.length) setReadError("No rewards found. The first row must hold the column names: Name, Description, Category, Price in points…");
      setRows(read);
    } catch {
      setReadError("That file couldn't be read. Use an Excel (.xlsx) or CSV file.");
    }
  };

  const setCost = (line: number, value: string) => setRows((rs) => rs && rs.map((r) => {
    if (r.line !== line) return r;
    const n = value.trim() ? Number(value.replace(/,/g, "")) : null;
    return { ...r, costFromPoints: false, input: { ...r.input, costAed: n !== null && Number.isFinite(n) ? n : r.input.costAed } };
  }));

  const ready = (rows ?? []).filter((r) => !r.problem && !r.duplicate);
  const skipped = (rows ?? []).length - ready.length;
  const photos = ready.filter((r) => r.photoName).length;

  const submit = () => {
    if (!ready.length) return;
    save.mutate(ready.map((r) => ({ ...r.input, status: inStore ? "active" : "hidden" })), { onSuccess: setResults });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <ResponsiveDialogContent desktopClassName="max-w-4xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Import rewards from Excel</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
            Columns as on the Add reward form: Name, Description, Category, Price in points, What it costs us (AED), Stock, Buy one for each redemption. Nothing is saved until you press Add.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-4 sm:px-0">
          {results ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{results.filter((r) => !r.error).length} of {results.length} added{inStore ? " to the store" : ", hidden"}.</p>
              <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                {results.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate">{r.name}</span>
                    {r.error ? <span className="text-xs text-destructive">{r.error}</span> : <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Added" />}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border p-5 text-center text-sm hover:bg-muted/40">
                <FileSpreadsheet className="h-6 w-6 text-muted-foreground" />
                <span className="font-medium">{fileName ?? "Choose an Excel or CSV file"}</span>
                <span className="text-xs text-muted-foreground">The first sheet is read; the first row is the column names.</span>
                <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              {readError && <p className="text-sm text-destructive">{readError}</p>}
              {!!rows?.length && (
                <>
                  <TableWrap>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Row</th>
                          <th className="px-3 py-2 font-medium">Reward</th>
                          <th className="px-3 py-2 text-right font-medium">Points</th>
                          <th className="px-3 py-2 text-right font-medium">Costs us (AED)</th>
                          <th className="px-3 py-2 font-medium">Stock</th>
                          <th className="px-3 py-2 font-medium">Bought each time</th>
                          <th className="px-3 py-2 font-medium">Check</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {rows.map((r) => {
                          const off = !!r.problem || r.duplicate;
                          return (
                            <tr key={`${fileName}-${r.line}`} className={cn(off && "text-muted-foreground")}>
                              <td className="px-3 py-2 tabular-nums">{r.line}</td>
                              <td className="px-3 py-2">
                                <p className="min-w-[12rem] font-medium">{r.input.name || "—"}</p>
                                <p className="text-xs text-muted-foreground">{r.input.category}</p>
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                                {formatPoints(r.input.points)}
                                <span className="block text-xs text-muted-foreground">{formatAed(dgoAed(r.input.points, pointValueAed))}</span>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Input
                                  aria-label={`What ${r.input.name} costs us`} inputMode="decimal" disabled={off}
                                  className="ml-auto h-8 w-28 text-right tabular-nums"
                                  defaultValue={r.input.costAed != null ? String(r.input.costAed) : ""}
                                  onBlur={(e) => setCost(r.line, e.target.value)}
                                />
                                {r.costFromPoints && <span className="mt-0.5 block text-[11px] text-amber-700 dark:text-amber-400">blank in the sheet — the points&apos; worth</span>}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2">{r.input.stockMode === "unlimited" ? "No limit" : formatPoints(r.input.stock ?? 0)}</td>
                              <td className="px-3 py-2">{r.input.buyPerRedemption ? "Yes" : "No"}</td>
                              <td className="px-3 py-2 text-xs">
                                {r.problem ? <span className="text-destructive">{r.problem}</span>
                                  : r.duplicate ? <span>Already in the catalogue — skipped</span>
                                    : <span className="text-emerald-700 dark:text-emerald-400">Ready</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </TableWrap>
                  {photos > 0 && (
                    <p className="text-xs text-muted-foreground">
                      The sheet names photos, but files can&apos;t come in through it: add each reward&apos;s photo afterwards with the edit button.
                    </p>
                  )}
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                    <div>
                      <p className="text-sm font-medium">Show them in the store now</p>
                      <p className="text-xs text-muted-foreground">Off adds them hidden, so you can add photos and check them first.</p>
                    </div>
                    <Switch checked={inStore} onCheckedChange={setInStore} aria-label="Show them in the store now" />
                  </div>
                </>
              )}
            </>
          )}
        </div>
        <ResponsiveDialogFooter>
          {!results && rows && <p className="mr-auto self-center text-xs text-muted-foreground">{ready.length} to add{skipped ? `, ${skipped} skipped` : ""}</p>}
          {results ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>Cancel</Button>
              <Button onClick={submit} disabled={!ready.length || save.isPending}>
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add {ready.length || ""} reward{ready.length === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
