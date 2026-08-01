"use client";
import { useState } from "react";
import { Target, Plus, Loader2, ClipboardList, Play, Square } from "lucide-react";
import {
  useMyAppraisals, useCycles, useAppraisals, useSetCycleStatus, useDeleteCycle,
} from "@/hooks/usePerformance";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { CycleDialog } from "@/components/performance/CycleDialog";
import { MyAppraisalDialog } from "@/components/performance/MyAppraisalDialog";
import { ReviewAppraisalDialog } from "@/components/performance/ReviewAppraisalDialog";
import { cn } from "@/lib/utils";
import {
  APPRAISAL_STATUS_LABELS, PERFORMANCE_CYCLE_STATUS_LABELS,
  type PerformanceCycle, type PerformanceCycleStatus, type AppraisalStatus,
} from "@/types";

const CYCLE_STATUS_STYLES: Record<PerformanceCycleStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  closed: "bg-sky-500/10 text-sky-600 border-sky-500/20",
};
const APPRAISAL_STATUS_STYLES: Record<AppraisalStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  submitted: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};
const fmtDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));

export default function PerformancePage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("performance", "view");
  const canCreate = hasPermission("performance", "create");
  const canEdit = hasPermission("performance", "edit");
  const canDelete = hasPermission("performance", "delete");

  const { data: mine, isLoading: mineLoading } = useMyAppraisals();
  const { data: cycles, isLoading: cyclesLoading } = useCycles({ enabled: canView });
  const { data: appraisals, isLoading: appraisalsLoading } = useAppraisals({ limit: "200" }, { enabled: canView });
  const { mutate: setCycleStatus, isPending: settingStatus } = useSetCycleStatus();
  const { mutate: removeCycle, isPending: deletingCycle } = useDeleteCycle();

  const [newCycleOpen, setNewCycleOpen] = useState(false);
  const [myAppraisalId, setMyAppraisalId] = useState<string | null>(null);
  const [reviewAppraisalId, setReviewAppraisalId] = useState<string | null>(null);
  const [deleteCycleTarget, setDeleteCycleTarget] = useState<PerformanceCycle | null>(null);

  // Derived from live query data (not a captured snapshot) so the open dialog reflects
  // status/rating changes as soon as the underlying query refetches.
  const myAppraisal = mine?.find((a) => a._id === myAppraisalId) ?? null;
  const reviewAppraisal = appraisals?.find((a) => a._id === reviewAppraisalId) ?? null;

  const [tab, setTab] = useState("mine");
  const tabs = [
    { key: "mine", label: "My Appraisal", icon: Target },
    canView && { key: "manage", label: "Manage", icon: ClipboardList },
  ].filter(Boolean) as { key: string; label: string; icon: React.ElementType }[];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "mine";

  return (
    <div>
      <PageHeader
        title="Performance"
        description="Goals, self-reviews, and manager appraisals."
        icon={Target}
        action={activeTab === "manage" && canCreate && <Button onClick={() => setNewCycleOpen(true)} className="shadow-sm"><Plus className="h-4 w-4" />New Cycle</Button>}
      />

      {tabs.length > 1 && <Tabs tabs={tabs} value={activeTab} onChange={setTab} />}

      {activeTab === "mine" && (
        mineLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !mine?.length ? (
          <Card className="p-16 text-center text-muted-foreground">
            <Target className="mx-auto mb-2 h-7 w-7" />No appraisal cycles yet.
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {mine.map((a) => {
              const cycle = typeof a.cycle === "object" ? a.cycle : null;
              return (
                <Card key={a._id} className="cursor-pointer p-4 transition-colors hover:bg-muted/30" onClick={() => setMyAppraisalId(a._id)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold">{cycle?.title ?? "Appraisal"}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{a.goals.length} goal{a.goals.length === 1 ? "" : "s"}</p>
                    </div>
                    <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", APPRAISAL_STATUS_STYLES[a.status])}>{APPRAISAL_STATUS_LABELS[a.status]}</span>
                  </div>
                </Card>
              );
            })}
          </div>
        )
      )}

      {activeTab === "manage" && (!canView ? (
        <Card className="p-16 text-center text-muted-foreground">You don&apos;t have access to performance management.</Card>
      ) : (
        <div className="space-y-6">
          <div>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Cycles</h2>
            {cyclesLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : !cycles?.length ? (
              <Card className="p-10 text-center text-muted-foreground">No cycles yet — create one to start.</Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Cycle</th>
                        <th className="px-4 py-3 font-medium">Period</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 text-right font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {cycles.map((c) => (
                        <tr key={c._id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3 font-medium">{c.title}</td>
                          <td className="px-4 py-3">{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</td>
                          <td className="px-4 py-3">
                            <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", CYCLE_STATUS_STYLES[c.status])}>{PERFORMANCE_CYCLE_STATUS_LABELS[c.status]}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {canEdit && c.status === "draft" && (
                                <Button size="sm" variant="outline" disabled={settingStatus} onClick={() => setCycleStatus({ id: c._id, status: "active" })}><Play className="h-3.5 w-3.5" />Activate</Button>
                              )}
                              {canEdit && c.status === "active" && (
                                <Button size="sm" variant="outline" disabled={settingStatus} onClick={() => setCycleStatus({ id: c._id, status: "closed" })}><Square className="h-3.5 w-3.5" />Close</Button>
                              )}
                              {canDelete && c.status === "draft" && (
                                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteCycleTarget(c)}>Delete</Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Appraisals</h2>
            {appraisalsLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : !appraisals?.length ? (
              <Card className="p-10 text-center text-muted-foreground">No appraisals yet — activate a cycle to generate them.</Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-3 font-medium">Employee</th>
                        <th className="px-4 py-3 font-medium">Cycle</th>
                        <th className="px-4 py-3 font-medium">Goals</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Rating</th>
                      </tr>
                    </thead>
                    <tbody>
                      {appraisals.map((a) => {
                        const emp = a.employee && typeof a.employee === "object" ? a.employee : null;
                        const cycle = typeof a.cycle === "object" ? a.cycle : null;
                        return (
                          <tr key={a._id} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/30" onClick={() => setReviewAppraisalId(a._id)}>
                            <td className="px-4 py-3">
                              <p className="font-medium">{emp?.name ?? "—"}</p>
                              <p className="text-xs text-muted-foreground">{emp?.employeeCode}</p>
                            </td>
                            <td className="px-4 py-3">{cycle?.title ?? "—"}</td>
                            <td className="px-4 py-3">{a.goals.length}</td>
                            <td className="px-4 py-3">
                              <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", APPRAISAL_STATUS_STYLES[a.status])}>{APPRAISAL_STATUS_LABELS[a.status]}</span>
                            </td>
                            <td className="px-4 py-3">{a.overallRating != null ? `${a.overallRating.toFixed(1)}/5` : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        </div>
      ))}

      <CycleDialog open={newCycleOpen} onOpenChange={setNewCycleOpen} />
      <MyAppraisalDialog open={!!myAppraisalId} onOpenChange={(o) => !o && setMyAppraisalId(null)} appraisal={myAppraisal} />
      <ReviewAppraisalDialog open={!!reviewAppraisalId} onOpenChange={(o) => !o && setReviewAppraisalId(null)} appraisal={reviewAppraisal} />
      <ConfirmDialog
        open={!!deleteCycleTarget} onOpenChange={(o) => !o && setDeleteCycleTarget(null)}
        title="Delete cycle" description="This draft cycle will be permanently removed." isPending={deletingCycle}
        onConfirm={() => deleteCycleTarget && removeCycle(deleteCycleTarget._id, { onSuccess: () => setDeleteCycleTarget(null) })}
      />
    </div>
  );
}
