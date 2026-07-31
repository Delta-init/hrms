"use client";
import { useState } from "react";
import { FileText, Plus, Pencil, Trash2, Loader2, Eye, Printer, Layers, ScrollText } from "lucide-react";
import {
  useGeneratedLetters, useDeleteGeneratedLetter,
  useLetterTemplates, useDeleteLetterTemplate,
} from "@/hooks/useLetters";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { GenerateLetterDialog } from "@/components/letters/GenerateLetterDialog";
import { LetterTemplateDialog } from "@/components/letters/LetterTemplateDialog";
import { ViewLetterDialog } from "@/components/letters/ViewLetterDialog";
import { printLetter } from "@/components/letters/printLetter";
import { getInitials } from "@/lib/utils";
import { LETTER_CATEGORY_LABELS, type GeneratedLetter, type LetterTemplate } from "@/types";

const fmtDate = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—");
const empOf = (l: GeneratedLetter) => (typeof l.employee === "object" ? l.employee : null);

export default function LettersPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("letters", "view");
  const canCreate = hasPermission("letters", "create");
  const canEdit = hasPermission("letters", "edit");
  const canDelete = hasPermission("letters", "delete");

  const [tab, setTab] = useState("generated");
  const { data: letters, isLoading: lettersLoading } = useGeneratedLetters();
  const { data: templates, isLoading: templatesLoading } = useLetterTemplates();
  const { mutate: removeLetter, isPending: deletingLetter } = useDeleteGeneratedLetter();
  const { mutate: removeTemplate, isPending: deletingTemplate } = useDeleteLetterTemplate();

  const [generateDialog, setGenerateDialog] = useState(false);
  const [templateDialog, setTemplateDialog] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<LetterTemplate | null>(null);
  const [viewLetter, setViewLetter] = useState<GeneratedLetter | null>(null);
  const [deleteLetterTarget, setDeleteLetterTarget] = useState<GeneratedLetter | null>(null);
  const [deleteTemplateTarget, setDeleteTemplateTarget] = useState<LetterTemplate | null>(null);

  const tabs = [
    { key: "generated", label: "Generated", icon: ScrollText },
    { key: "templates", label: "Templates", icon: Layers },
  ];

  return (
    <div>
      <PageHeader
        title="Letters"
        description="Reusable letter templates with merge fields, generated into per-employee letters — offer, appointment, experience, relieving and more."
        icon={FileText}
        action={
          canCreate && (
            tab === "generated"
              ? <Button onClick={() => setGenerateDialog(true)} className="shadow-sm" disabled={!templates?.length}><Plus className="h-4 w-4" />Generate Letter</Button>
              : <Button onClick={() => { setSelectedTemplate(null); setTemplateDialog(true); }} className="shadow-sm"><Plus className="h-4 w-4" />New Template</Button>
          )
        }
      />

      {!canView ? (
        <Card className="p-16 text-center text-muted-foreground">You don&apos;t have access to letters.</Card>
      ) : (
      <>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === "generated" && (
        lettersLoading ? (
          <div className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !letters?.length ? (
          <Card className="p-16 text-center text-muted-foreground">
            <ScrollText className="mx-auto mb-2 h-7 w-7" />
            No letters generated yet. Create a template, then generate one for an employee.
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Subject</th>
                    <th className="px-4 py-3 font-medium">Category</th>
                    <th className="px-4 py-3 font-medium">Issued</th>
                    <th className="px-4 py-3 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {letters.map((l) => {
                    const emp = empOf(l);
                    return (
                      <tr key={l._id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{getInitials(emp?.name ?? "?")}</div>
                            <div className="min-w-0"><p className="truncate font-medium">{emp?.name ?? "—"}</p><p className="truncate text-xs text-muted-foreground">{emp?.employeeCode ?? ""}</p></div>
                          </div>
                        </td>
                        <td className="px-4 py-3 max-w-[280px] truncate">{l.subject}</td>
                        <td className="px-4 py-3"><Badge variant="secondary" className="capitalize">{LETTER_CATEGORY_LABELS[l.category]}</Badge></td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(l.issuedAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-8 w-8" title="View" onClick={() => setViewLetter(l)}><Eye className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" title="Print / PDF" onClick={() => printLetter(l)}><Printer className="h-4 w-4" /></Button>
                            {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteLetterTarget(l)}><Trash2 className="h-4 w-4" /></Button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )
      )}

      {tab === "templates" && (
        templatesLoading ? (
          <div className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : !templates?.length ? (
          <Card className="p-16 text-center text-muted-foreground">
            <Layers className="mx-auto mb-2 h-7 w-7" />
            No templates yet — create one to start generating letters.
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {templates.map((t) => (
              <Card key={t._id} className="group p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold">{t.name}</p>
                      <Badge variant={t.status === "active" ? "secondary" : "outline"} className="capitalize">{t.status}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{LETTER_CATEGORY_LABELS[t.category]}</p>
                  </div>
                  {(canEdit || canDelete) && (
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      {canEdit && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setSelectedTemplate(t); setTemplateDialog(true); }}><Pencil className="h-3.5 w-3.5" /></Button>}
                      {canDelete && <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteTemplateTarget(t)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                    </div>
                  )}
                </div>
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{t.body}</p>
              </Card>
            ))}
          </div>
        )
      )}
      </>
      )}

      <GenerateLetterDialog open={generateDialog} onOpenChange={setGenerateDialog} onGenerated={(letter) => setViewLetter(letter)} />
      <LetterTemplateDialog open={templateDialog} onOpenChange={setTemplateDialog} template={selectedTemplate} />
      <ViewLetterDialog open={!!viewLetter} onOpenChange={(o) => !o && setViewLetter(null)} letter={viewLetter} />

      <ConfirmDialog
        open={!!deleteLetterTarget} onOpenChange={(o) => !o && setDeleteLetterTarget(null)}
        title="Delete letter" description="This generated letter record will be permanently removed." isPending={deletingLetter}
        onConfirm={() => deleteLetterTarget && removeLetter(deleteLetterTarget._id, { onSuccess: () => setDeleteLetterTarget(null) })}
      />
      <ConfirmDialog
        open={!!deleteTemplateTarget} onOpenChange={(o) => !o && setDeleteTemplateTarget(null)}
        title="Delete template" description="Letters already generated from this template are unaffected." isPending={deletingTemplate}
        onConfirm={() => deleteTemplateTarget && removeTemplate(deleteTemplateTarget._id, { onSuccess: () => setDeleteTemplateTarget(null) })}
      />
    </div>
  );
}
