"use client";
import { useState } from "react";
import {
  ListChecks, Plus, Pencil, Trash2, Loader2, BarChart3, Play, Square, CheckCircle2,
} from "lucide-react";
import {
  useSurveys, useMySurveys, useDeleteSurvey, useSetSurveyStatus,
} from "@/hooks/useSurveys";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { SurveyDialog } from "@/components/surveys/SurveyDialog";
import { SurveyResponseDialog } from "@/components/surveys/SurveyResponseDialog";
import { SurveyResultsDialog } from "@/components/surveys/SurveyResultsDialog";
import { cn } from "@/lib/utils";
import { SURVEY_STATUS_LABELS, type Survey, type SurveyStatus } from "@/types";

const statusStyles: Record<SurveyStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  closed: "bg-sky-500/10 text-sky-600 border-sky-500/20",
};

export default function SurveysPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("surveys", "view");
  const canCreate = hasPermission("surveys", "create");
  const canEdit = hasPermission("surveys", "edit");
  const canDelete = hasPermission("surveys", "delete");

  const { data: mine, isLoading: mineLoading } = useMySurveys();
  const { data: all, isLoading: allLoading } = useSurveys({ enabled: canView });
  const { mutate: remove, isPending: deleting } = useDeleteSurvey();
  const { mutate: setStatus, isPending: settingStatus } = useSetSurveyStatus();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<Survey | null>(null);
  const [respondTarget, setRespondTarget] = useState<Survey | null>(null);
  const [resultsTarget, setResultsTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Survey | null>(null);

  const [tab, setTab] = useState("open");
  const tabs = [
    { key: "open", label: "Open Surveys", icon: ListChecks },
    canView && { key: "manage", label: "Manage", icon: BarChart3 },
  ].filter(Boolean) as { key: string; label: string; icon: React.ElementType }[];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "open";

  return (
    <div>
      <PageHeader
        title="Surveys"
        description="Gather feedback with quick pulse surveys."
        icon={ListChecks}
        action={activeTab === "manage" && canCreate && <Button onClick={() => { setSelected(null); setDialogOpen(true); }} className="shadow-sm"><Plus className="h-4 w-4" />New Survey</Button>}
      />

      {tabs.length > 1 && <Tabs tabs={tabs} value={activeTab} onChange={setTab} />}

      {activeTab === "open" && (
        mineLoading ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !mine?.length ? (
          <Card className="p-16 text-center text-muted-foreground">
            <ListChecks className="mx-auto mb-2 h-7 w-7" />No open surveys right now.
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {mine.map((s) => (
              <Card key={s._id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{s.title}</h3>
                    {s.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.description}</p>}
                  </div>
                  {s.hasResponded && <Badge variant="outline" className="shrink-0 gap-1 border-emerald-500/20 bg-emerald-500/10 text-emerald-600"><CheckCircle2 className="h-3 w-3" />Done</Badge>}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{s.questions.length} question{s.questions.length === 1 ? "" : "s"}</p>
                {!s.hasResponded && (
                  <Button size="sm" className="mt-3 w-full" onClick={() => setRespondTarget(s)}>Respond</Button>
                )}
              </Card>
            ))}
          </div>
        )
      )}

      {activeTab === "manage" && (!canView ? (
        <Card className="p-16 text-center text-muted-foreground">You don&apos;t have access to surveys.</Card>
      ) : allLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !all?.length ? (
        <Card className="p-16 text-center text-muted-foreground">
          <ListChecks className="mx-auto mb-2 h-7 w-7" />No surveys yet.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Survey</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Questions</th>
                  <th className="px-4 py-3 font-medium">Responses</th>
                  <th className="px-4 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {all.map((s) => (
                  <tr key={s._id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <p className="font-medium">{s.title}</p>
                      {s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", statusStyles[s.status])}>{SURVEY_STATUS_LABELS[s.status]}</span>
                    </td>
                    <td className="px-4 py-3">{s.questions.length}</td>
                    <td className="px-4 py-3">{s.responseCount ?? 0}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Results" onClick={() => setResultsTarget(s._id)}><BarChart3 className="h-4 w-4" /></Button>
                        {canEdit && s.status === "draft" && (
                          <Button size="sm" variant="outline" disabled={settingStatus} onClick={() => setStatus({ id: s._id, status: "active" })}><Play className="h-3.5 w-3.5" />Activate</Button>
                        )}
                        {canEdit && s.status === "active" && (
                          <Button size="sm" variant="outline" disabled={settingStatus} onClick={() => setStatus({ id: s._id, status: "closed" })}><Square className="h-3.5 w-3.5" />Close</Button>
                        )}
                        {canEdit && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setSelected(s); setDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button>}
                        {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(s)}><Trash2 className="h-4 w-4" /></Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <SurveyDialog open={dialogOpen} onOpenChange={setDialogOpen} survey={selected} />
      <SurveyResponseDialog open={!!respondTarget} onOpenChange={(o) => !o && setRespondTarget(null)} survey={respondTarget} />
      <SurveyResultsDialog open={!!resultsTarget} onOpenChange={(o) => !o && setResultsTarget(null)} surveyId={resultsTarget} />
      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete survey" description="This survey and all its responses will be permanently removed." isPending={deleting}
        onConfirm={() => deleteTarget && remove(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) })}
      />
    </div>
  );
}
