"use client";
import { useState } from "react";
import { ClipboardList, Plus, Pencil, Trash2, Loader2, ListChecks, LayoutList } from "lucide-react";
import {
  useOnboardingChecklists, useDeleteOnboardingChecklist,
  useOnboardingTemplates, useDeleteOnboardingTemplate,
} from "@/hooks/useOnboardingChecklists";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ChecklistCard } from "@/components/onboarding-tasks/ChecklistCard";
import { CreateChecklistDialog } from "@/components/onboarding-tasks/CreateChecklistDialog";
import { OnboardingTemplateDialog } from "@/components/onboarding-tasks/OnboardingTemplateDialog";
import { ONBOARDING_CATEGORY_LABELS, type OnboardingChecklist, type OnboardingTemplate } from "@/types";

export default function OnboardingTasksPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("onboardingTasks", "view");
  const canCreate = hasPermission("onboardingTasks", "create");
  const canEdit = hasPermission("onboardingTasks", "edit");
  const canDelete = hasPermission("onboardingTasks", "delete");

  const [tab, setTab] = useState("checklists");
  const { data: checklists, isLoading: checklistsLoading } = useOnboardingChecklists(canView ? {} : undefined);
  const { data: templates, isLoading: templatesLoading } = useOnboardingTemplates();
  const { mutate: removeChecklist, isPending: deletingChecklist } = useDeleteOnboardingChecklist();
  const { mutate: removeTemplate, isPending: deletingTemplate } = useDeleteOnboardingTemplate();

  const [checklistDialog, setChecklistDialog] = useState(false);
  const [templateDialog, setTemplateDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<OnboardingTemplate | null>(null);
  const [deleteChecklistTarget, setDeleteChecklistTarget] = useState<OnboardingChecklist | null>(null);
  const [deleteTemplateTarget, setDeleteTemplateTarget] = useState<OnboardingTemplate | null>(null);

  const tabs = [
    { key: "checklists", label: "Checklists", icon: ListChecks },
    { key: "templates", label: "Templates", icon: LayoutList },
  ];

  return (
    <div>
      <PageHeader
        title="Onboarding Tasks"
        description="Task-based onboarding checklists for new hires, generated from reusable templates."
        icon={ClipboardList}
        action={
          canCreate && (
            tab === "checklists"
              ? <Button onClick={() => setChecklistDialog(true)} className="shadow-sm"><Plus className="h-4 w-4" />New Checklist</Button>
              : <Button onClick={() => { setSelectedTemplate(null); setTemplateDialog(true); }} className="shadow-sm"><Plus className="h-4 w-4" />New Template</Button>
          )
        }
      />

      {!canView ? (
        <Card className="p-16 text-center text-muted-foreground">You don&apos;t have access to onboarding tasks.</Card>
      ) : (
        <>
          <Tabs tabs={tabs} value={tab} onChange={setTab} />

          {tab === "checklists" && (
            checklistsLoading ? (
              <div className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !checklists?.length ? (
              <Card className="p-16 text-center text-muted-foreground">
                <ListChecks className="mx-auto mb-2 h-7 w-7" />
                No onboarding checklists yet. Create a template, then assign it to a new hire.
              </Card>
            ) : (
              <div className="space-y-3">
                {checklists.map((c) => (
                  <ChecklistCard key={c._id} checklist={c} canEdit={canEdit} canDelete={canDelete} onDelete={() => setDeleteChecklistTarget(c)} />
                ))}
              </div>
            )
          )}

          {tab === "templates" && (
            templatesLoading ? (
              <div className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !templates?.length ? (
              <Card className="p-16 text-center text-muted-foreground">
                <LayoutList className="mx-auto mb-2 h-7 w-7" />
                No templates yet — create one to start assigning checklists.
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {templates.map((t) => (
                  <Card key={t._id} className="group p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{t.name}</p>
                        {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                      </div>
                      {(canEdit || canDelete) && (
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          {canEdit && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setSelectedTemplate(t); setTemplateDialog(true); }}><Pencil className="h-3.5 w-3.5" /></Button>}
                          {canDelete && <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteTemplateTarget(t)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                        </div>
                      )}
                    </div>
                    <p className="mt-2 text-xs font-medium text-muted-foreground">{t.tasks.length} task{t.tasks.length === 1 ? "" : "s"}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {Array.from(new Set(t.tasks.map((task) => task.category))).map((cat) => (
                        <span key={cat} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{ONBOARDING_CATEGORY_LABELS[cat]}</span>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            )
          )}
        </>
      )}

      <CreateChecklistDialog open={checklistDialog} onOpenChange={setChecklistDialog} />
      <OnboardingTemplateDialog open={templateDialog} onOpenChange={setTemplateDialog} template={selectedTemplate} />

      <ConfirmDialog
        open={!!deleteChecklistTarget} onOpenChange={(o) => !o && setDeleteChecklistTarget(null)}
        title="Delete checklist" description="This employee's onboarding checklist and its progress will be permanently removed." isPending={deletingChecklist}
        onConfirm={() => deleteChecklistTarget && removeChecklist(deleteChecklistTarget._id, { onSuccess: () => setDeleteChecklistTarget(null) })}
      />
      <ConfirmDialog
        open={!!deleteTemplateTarget} onOpenChange={(o) => !o && setDeleteTemplateTarget(null)}
        title="Delete template" description="Existing checklists created from this template are unaffected." isPending={deletingTemplate}
        onConfirm={() => deleteTemplateTarget && removeTemplate(deleteTemplateTarget._id, { onSuccess: () => setDeleteTemplateTarget(null) })}
      />
    </div>
  );
}
