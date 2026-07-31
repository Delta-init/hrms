"use client";
import { useState } from "react";
import { ChevronDown, Trash2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useSetOnboardingTaskStatus } from "@/hooks/useOnboardingChecklists";
import { getInitials, cn } from "@/lib/utils";
import { ONBOARDING_CATEGORY_LABELS, ONBOARDING_ASSIGNEE_LABELS, type OnboardingChecklist } from "@/types";

const fmtDate = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(new Date(iso)) : "—");

interface Props {
  checklist: OnboardingChecklist;
  canEdit: boolean;
  canDelete: boolean;
  onDelete: () => void;
}

export function ChecklistCard({ checklist, canEdit, canDelete, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { mutate: setStatus, isPending } = useSetOnboardingTaskStatus();

  const emp = typeof checklist.employee === "object" ? checklist.employee : null;
  const total = checklist.tasks.length;
  const done = checklist.tasks.filter((t) => t.status === "completed").length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <Card className="overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded((v) => !v); } }}
        className="flex w-full cursor-pointer items-center gap-3 p-4 text-left"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{getInitials(emp?.name ?? "?")}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{emp?.name ?? "Unknown"}</p>
          <p className="truncate text-xs text-muted-foreground">{checklist.templateName} · {emp?.employeeCode}</p>
        </div>
        <div className="hidden w-40 shrink-0 sm:block">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground"><span>{done}/{total} done</span><span>{percent}%</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full transition-all", percent === 100 ? "bg-emerald-500" : "bg-primary")} style={{ width: `${percent}%` }} />
          </div>
        </div>
        {canDelete && (
          <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </div>

      <div className="px-4 pb-2 sm:hidden">
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground"><span>{done}/{total} done</span><span>{percent}%</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full transition-all", percent === 100 ? "bg-emerald-500" : "bg-primary")} style={{ width: `${percent}%` }} />
        </div>
      </div>

      {expanded && (
        <div className="space-y-1.5 border-t border-border p-3">
          {checklist.tasks.map((t) => (
            <div key={t._id} className={cn("flex items-start gap-3 rounded-lg border border-border p-2.5", t.status === "completed" && "bg-muted/30")}>
              <Checkbox
                checked={t.status === "completed"}
                disabled={!canEdit || isPending}
                onCheckedChange={(checked) => setStatus({ checklistId: checklist._id, taskId: t._id, status: checked ? "completed" : "pending" })}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium", t.status === "completed" && "text-muted-foreground line-through")}>{t.title}</p>
                {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {ONBOARDING_CATEGORY_LABELS[t.category]} · {ONBOARDING_ASSIGNEE_LABELS[t.assigneeRole]} · Due {fmtDate(t.dueDate)}
                </p>
              </div>
              {isPending && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
