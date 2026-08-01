"use client";
import { useState } from "react";
import {
  Boxes, Plus, Pencil, Trash2, Loader2, Send, Undo2, CheckCircle2, Archive, History, ListChecks,
} from "lucide-react";
import { useAssets, useMyAssets, useDeleteAsset, useMarkAssetAvailable, useRetireAsset } from "@/hooks/useAssets";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { AssetDialog } from "@/components/assets/AssetDialog";
import { IssueAssetDialog } from "@/components/assets/IssueAssetDialog";
import { ReturnAssetDialog } from "@/components/assets/ReturnAssetDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { getInitials, cn } from "@/lib/utils";
import {
  ASSET_CATEGORY_LABELS, ASSET_CONDITION_LABELS, ASSET_STATUS_LABELS,
  type Asset, type AssetCategory, type AssetStatus,
} from "@/types";

const ALL = "__all__";
const statusStyles: Record<AssetStatus, string> = {
  available: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  assigned: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  maintenance: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  retired: "bg-muted text-muted-foreground border-border",
};
const conditionStyles: Record<string, string> = {
  new: "text-emerald-600", good: "text-emerald-600", fair: "text-amber-600",
  poor: "text-red-500", damaged: "text-red-600",
};
const assigneeOf = (a: Asset) => (a.assignedTo && typeof a.assignedTo === "object" ? a.assignedTo : null);
const fmtDate = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—");

export default function AssetsPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("assets", "view");
  const canCreate = hasPermission("assets", "create");
  const canEdit = hasPermission("assets", "edit");
  const canDelete = hasPermission("assets", "delete");

  const [status, setStatus] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [search, setSearch] = useState("");
  const params: Record<string, string> = { limit: "200" };
  if (status !== ALL) params.status = status;
  if (category !== ALL) params.category = category;
  if (search) params.search = search;

  const { data, isLoading, isFetching } = useAssets(canView ? params : undefined);
  const rows = data?.data ?? [];
  const { data: mine, isLoading: mineLoading } = useMyAssets();
  const { mutate: remove, isPending: deleting } = useDeleteAsset();
  const { mutate: markAvailable, isPending: markingAvailable } = useMarkAssetAvailable();
  const { mutate: retire, isPending: retiring } = useRetireAsset();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<Asset | null>(null);
  const [issueTarget, setIssueTarget] = useState<Asset | null>(null);
  const [returnTarget, setReturnTarget] = useState<Asset | null>(null);
  const [historyTarget, setHistoryTarget] = useState<Asset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [retireTarget, setRetireTarget] = useState<Asset | null>(null);

  const [tab, setTab] = useState("mine");
  const tabs = [
    { key: "mine", label: "My Assets", icon: Boxes },
    canView && { key: "all", label: "All Assets", icon: ListChecks },
  ].filter(Boolean) as { key: string; label: string; icon: React.ElementType }[];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "mine";

  return (
    <div>
      <PageHeader
        title="Assets"
        description="Track company equipment from purchase through issue, return and retirement."
        icon={Boxes}
        action={activeTab === "all" && canCreate && <Button onClick={() => { setSelected(null); setDialogOpen(true); }} className="shadow-sm"><Plus className="h-4 w-4" />New Asset</Button>}
      />

      <Tabs tabs={tabs} value={activeTab} onChange={setTab} />

      {activeTab === "mine" && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Asset</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Condition</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {mineLoading ? (
                  <tr><td colSpan={4} className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></td></tr>
                ) : !mine?.length ? (
                  <tr><td colSpan={4} className="py-16 text-center text-muted-foreground"><Boxes className="mx-auto mb-2 h-7 w-7" />No assets currently assigned to you.</td></tr>
                ) : mine.map((a) => (
                  <tr key={a._id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <p className="font-medium">{a.name}</p>
                      <p className="text-xs text-muted-foreground">{a.assetTag}{a.serialNumber ? ` · SN ${a.serialNumber}` : ""}</p>
                    </td>
                    <td className="px-4 py-3">{ASSET_CATEGORY_LABELS[a.category]}</td>
                    <td className={cn("px-4 py-3 font-medium", conditionStyles[a.condition])}>{ASSET_CONDITION_LABELS[a.condition]}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[a.status])}>{ASSET_STATUS_LABELS[a.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeTab === "all" && (!canView ? (
        <Card className="p-16 text-center text-muted-foreground">You don&apos;t have access to assets.</Card>
      ) : (
        <div className="space-y-4">
          <Card className="flex flex-wrap items-end gap-4 p-4">
            <div className="min-w-[200px] flex-1 space-y-1.5">
              <Label className="text-xs text-muted-foreground">Search</Label>
              <Input placeholder="Name, tag, serial…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All status</SelectItem>
                  {(Object.keys(ASSET_STATUS_LABELS) as AssetStatus[]).map((k) => <SelectItem key={k} value={k}>{ASSET_STATUS_LABELS[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All categories</SelectItem>
                  {(Object.keys(ASSET_CATEGORY_LABELS) as AssetCategory[]).map((k) => <SelectItem key={k} value={k}>{ASSET_CATEGORY_LABELS[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Asset</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium">Condition</th>
                    <th className="px-4 py-3 font-medium">Assigned to</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading || isFetching ? (
                    <tr><td colSpan={6} className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={6} className="py-16 text-center text-muted-foreground"><Boxes className="mx-auto mb-2 h-7 w-7" />No assets match these filters.</td></tr>
                  ) : rows.map((a) => {
                    const assignee = assigneeOf(a);
                    return (
                      <tr key={a._id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <p className="font-medium">{a.name}</p>
                          <p className="text-xs text-muted-foreground">{a.assetTag}{a.serialNumber ? ` · SN ${a.serialNumber}` : ""}</p>
                        </td>
                        <td className="px-4 py-3">{ASSET_CATEGORY_LABELS[a.category]}</td>
                        <td className={cn("px-4 py-3 font-medium", conditionStyles[a.condition])}>{ASSET_CONDITION_LABELS[a.condition]}</td>
                        <td className="px-4 py-3">
                          {assignee ? (
                            <div className="flex items-center gap-2">
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{getInitials(assignee.name)}</div>
                              <span className="truncate">{assignee.name}</span>
                            </div>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[a.status])}>{ASSET_STATUS_LABELS[a.status]}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-8 w-8" title="History" onClick={() => setHistoryTarget(a)}><History className="h-4 w-4" /></Button>
                            {canEdit && a.status === "available" && <Button size="sm" variant="outline" onClick={() => setIssueTarget(a)}><Send className="h-3.5 w-3.5" />Issue</Button>}
                            {canEdit && a.status === "assigned" && <Button size="sm" variant="outline" onClick={() => setReturnTarget(a)}><Undo2 className="h-3.5 w-3.5" />Return</Button>}
                            {canEdit && a.status === "maintenance" && <Button size="sm" variant="outline" onClick={() => markAvailable(a._id)} disabled={markingAvailable}><CheckCircle2 className="h-3.5 w-3.5" />Available</Button>}
                            {canEdit && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setSelected(a); setDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button>}
                            {canEdit && a.status !== "retired" && a.status !== "assigned" && (
                              <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" title="Retire" onClick={() => setRetireTarget(a)}><Archive className="h-4 w-4" /></Button>
                            )}
                            {canDelete && a.status !== "assigned" && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(a)}><Trash2 className="h-4 w-4" /></Button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ))}

      <AssetDialog open={dialogOpen} onOpenChange={setDialogOpen} asset={selected} />
      <IssueAssetDialog open={!!issueTarget} onOpenChange={(o) => !o && setIssueTarget(null)} asset={issueTarget} />
      <ReturnAssetDialog open={!!returnTarget} onOpenChange={(o) => !o && setReturnTarget(null)} asset={returnTarget} />

      <ResponsiveDialog open={!!historyTarget} onOpenChange={(o) => !o && setHistoryTarget(null)}>
        <ResponsiveDialogContent desktopClassName="max-w-md max-h-[80vh] overflow-y-auto">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{historyTarget?.name} — History</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-2 px-4 pb-4 sm:px-0">
            {!historyTarget?.history.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No history yet.</p>
            ) : [...historyTarget.history].reverse().map((h, i) => {
              const emp = h.employee && typeof h.employee === "object" ? h.employee.name : null;
              return (
                <div key={i} className="rounded-lg border border-border p-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize">{h.action.replace(/_/g, " ")}</span>
                    <span className="text-xs text-muted-foreground">{fmtDate(h.date)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {[emp, h.condition ? ASSET_CONDITION_LABELS[h.condition] : null].filter(Boolean).join(" · ") || "—"}
                  </p>
                  {h.notes && <p className="mt-1 text-xs text-muted-foreground">{h.notes}</p>}
                </div>
              );
            })}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete asset" description="This asset and its history will be permanently removed." isPending={deleting}
        onConfirm={() => deleteTarget && remove(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) })}
      />
      <ConfirmDialog
        open={!!retireTarget} onOpenChange={(o) => !o && setRetireTarget(null)}
        title="Retire asset" description="This asset will be marked retired and can no longer be issued." confirmLabel="Retire" isPending={retiring}
        onConfirm={() => retireTarget && retire(retireTarget._id, { onSuccess: () => setRetireTarget(null) })}
      />
    </div>
  );
}
