"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Users } from "lucide-react";
import { useTeamFirstDays } from "@/hooks/useFirstDays";
import { PageHeader } from "@/components/shared/PageHeader";
import { FirstDaysSteps, actionsFor } from "@/components/firstDays/FirstDaysSteps";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The new joiners a department head or HR looks after, each with their steps
 * and the buttons that are this person's to press — the head confirms the
 * session, sends homework, gives CRM access and assigns clients; HR gives 3CX
 * and Zoho, and stands in for a head where a department has none.
 */
export default function TeamFirstDaysPage() {
  const { data = [], isLoading } = useTeamFirstDays();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader title="New joiners" description="People in their first fifteen days, and what each is waiting on." icon={Users} />
      {isLoading ? (
        <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !data.length ? (
        <Card className="p-16 text-center text-muted-foreground">Nobody is in their first fifteen days right now.</Card>
      ) : (
        <div className="space-y-3">
          {data.map((v) => {
            const id = v.employee._id;
            const isOpen = open === id || data.length === 1;
            const mine = actionsFor(v);
            return (
              <Card key={id} className="overflow-hidden">
                <button type="button" onClick={() => setOpen(isOpen ? null : id)}
                  className="flex w-full flex-wrap items-center gap-3 p-4 text-left hover:bg-muted/40">
                  {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{v.employee.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[v.employee.department?.name, v.employee.designation].filter(Boolean).join(" · ") || "—"}
                      {v.employee.department?.isSales ? " · Sales" : ""}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">{v.redActive ? `Day ${v.day} of ${v.of}` : "Past day 15"}</span>
                  <span className="text-xs text-muted-foreground">{v.doneCount} / {v.totalCount} done</span>
                  {mine > 0 && (
                    <span className={cn("rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary")}>
                      {mine} for you
                    </span>
                  )}
                </button>
                {isOpen && <div className="border-t border-border p-4"><FirstDaysSteps view={v} /></div>}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
