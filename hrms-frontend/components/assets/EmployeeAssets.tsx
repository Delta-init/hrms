"use client";
import Link from "next/link";
import { Boxes, Loader2, ArrowUpRight, History } from "lucide-react";
import { useAssets } from "@/hooks/useAssets";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ASSET_CATEGORY_LABELS, ASSET_CONDITION_LABELS, ASSET_STATUS_LABELS,
  type Asset, type AssetCondition, type AssetStatus,
} from "@/types";

const fmtDate = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—";

const statusTone: Record<AssetStatus, string> = {
  assigned: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400",
  available: "bg-muted text-muted-foreground border-border",
  maintenance: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400",
  retired: "bg-muted text-muted-foreground border-border",
};

const conditionTone: Record<AssetCondition, string> = {
  new: "text-emerald-600 dark:text-emerald-400",
  good: "text-emerald-600 dark:text-emerald-400",
  fair: "text-amber-600 dark:text-amber-400",
  poor: "text-orange-600 dark:text-orange-400",
  damaged: "text-red-600 dark:text-red-400",
};

/**
 * What this person is currently holding.
 *
 * Assets were only browsable from the asset's side — a list of things, each
 * naming whoever has it. The question actually asked is the other way round,
 * and it gets asked at two moments: when somebody leaves and their kit has to
 * come back, and when something goes missing. Neither is a good time to be
 * filtering a table of every laptop in the company.
 *
 * Keyed on the employee record rather than the login, because that is what an
 * asset is issued to — a laptop can go to somebody who has no account at all.
 *
 * Two lists, because a leaver's checklist needs both: what is still out, and
 * what already came back. Returning an asset clears its `assignedTo`, so the
 * second one is answered from each asset's history rather than its current
 * assignee.
 */
export function EmployeeAssets({ employeeId }: { employeeId: string | null }) {
  const { data, isLoading } = useAssets(
    employeeId ? { assignedTo: employeeId, limit: "100", sortBy: "name", sortOrder: "asc" } : undefined
  );
  const { data: pastData, isLoading: pastLoading } = useAssets(
    employeeId ? { previouslyAssignedTo: employeeId, limit: "100", sortBy: "name", sortOrder: "asc" } : undefined
  );
  const assets = employeeId ? data?.data ?? [] : [];
  const past = employeeId ? pastData?.data ?? [] : [];

  if (!employeeId) {
    return (
      <Card className="p-12 text-center">
        <Boxes className="mx-auto mb-2 h-7 w-7 text-muted-foreground/50" />
        <p className="text-sm font-medium">No employee record</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Assets are issued to an employee, so this login needs an employee profile before anything
          can be assigned to it.
        </p>
      </Card>
    );
  }

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const totalValue = assets.reduce((sum, a) => sum + (a.purchaseCost ?? 0), 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Assets held</h3>
          <p className="text-xs text-muted-foreground">
            {assets.length === 0
              ? "Nothing is currently issued to this person."
              : `${assets.length} item${assets.length === 1 ? "" : "s"} issued and not yet returned` +
                (totalValue > 0 ? ` · ${totalValue.toLocaleString()} at purchase` : "")}
          </p>
        </div>
        <Link href="/assets" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          All assets <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {assets.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          Nothing issued. Assets are handed out from the Assets page.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {assets.map((a) => <AssetCard key={a._id} asset={a} />)}
        </div>
      )}

      {/* Only when there is something to show — an empty "previously held"
          heading on somebody who has never handed anything back is noise. */}
      {!pastLoading && past.length > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-semibold">Previously held</h3>
              <p className="text-xs text-muted-foreground">
                Issued to this person at some point and since handed back or passed on.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {past.map((a) => <AssetCard key={a._id} asset={a} past employeeId={employeeId} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function AssetCard({ asset: a, past, employeeId }: { asset: Asset; past?: boolean; employeeId?: string }) {
  // On a past asset the current status describes somebody else's situation, so
  // what matters is when this person had it — read off their own history entries.
  const mine = past && employeeId
    ? a.history.filter((h) => idOf(h.employee) === employeeId)
    : [];
  const issued = mine.find((h) => h.action === "issued")?.date;
  const returned = [...mine].reverse().find((h) => h.action === "returned")?.date;

  return (
    <Card className={cn("p-4", past && "bg-muted/30")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{a.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {ASSET_CATEGORY_LABELS[a.category]} · <span className="font-mono">{a.assetTag}</span>
          </p>
        </div>
        {past ? (
          <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Returned
          </span>
        ) : (
          <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium", statusTone[a.status])}>
            {ASSET_STATUS_LABELS[a.status]}
          </span>
        )}
      </div>

      <dl className="mt-3 space-y-1 text-xs">
        {a.serialNumber && (
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-muted-foreground">Serial</dt>
            <dd className="truncate font-mono">{a.serialNumber}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Issued</dt>
          <dd>{fmtDate(past ? issued : a.assignedDate)}</dd>
        </div>
        {past ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Returned</dt>
            <dd>{fmtDate(returned)}</dd>
          </div>
        ) : (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Condition</dt>
            <dd className={cn("font-medium", conditionTone[a.condition])}>{ASSET_CONDITION_LABELS[a.condition]}</dd>
          </div>
        )}
      </dl>

      {a.notes && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{a.notes}</p>}
    </Card>
  );
}

const idOf = (v: unknown) =>
  v && typeof v === "object" ? String((v as { _id?: unknown })._id ?? "") : v ? String(v) : "";
