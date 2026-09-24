"use client";
import { useState } from "react";
import { FileText, Loader2, Plus, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useMyPerformanceReports, usePerformanceReports } from "@/hooks/useMonthlyPerformanceReports";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PerformanceReportDialog } from "@/components/performance/PerformanceReportDialog";
import type { MonthlyPerformanceReport } from "@/types";

const nameOf = (v: unknown) => (v && typeof v === "object" ? String((v as { name?: string }).name ?? "") : "");
const fmtMonth = (m: string) => {
  const [y, mm] = m.split("-");
  return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString([], { month: "long", year: "numeric" });
};

function ReportCard({ r, showEmployee }: { r: MonthlyPerformanceReport; showEmployee?: boolean }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{fmtMonth(r.month)}</p>
          {showEmployee && <p className="text-xs text-muted-foreground">{nameOf(r.employee) || "—"}</p>}
        </div>
        {r.reportUrl && (
          <a href={r.reportUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-primary hover:bg-muted">
            <FileText className="h-3.5 w-3.5" />{r.reportFileName || "Document"}
          </a>
        )}
      </div>
      {r.reportText && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{r.reportText}</p>}
      <p className="mt-2 text-[11px] text-muted-foreground">Filed by {nameOf(r.submittedBy) || "—"}</p>
    </Card>
  );
}

/**
 * A file or a few written lines, once a month — for yourself, or for anyone
 * on your own team if you head one. HR sees every team's; a department head
 * who does not also hold the permission is narrowed to their own.
 */
export function MonthlyReports() {
  const { hasPermission, user } = useAuth();
  const canSeeTeam = hasPermission("performance", "edit") || !!user?.isDepartmentHead;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [month, setMonth] = useState("");

  const { data: mine, isLoading: mineLoading } = useMyPerformanceReports();
  const { data: team, isLoading: teamLoading } = usePerformanceReports(month ? { month } : undefined, canSeeTeam);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">A file or a few written lines about how the month went.</p>
        <Button onClick={() => setDialogOpen(true)} className="shadow-sm"><Plus className="h-4 w-4" />File a report</Button>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Your reports</h2>
        {mineLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : !mine?.data.length ? (
          <Card className="p-10 text-center text-muted-foreground">You haven&apos;t filed one yet.</Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {mine.data.map((r) => <ReportCard key={r._id} r={r} />)}
          </div>
        )}
      </div>

      {canSeeTeam && (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <Users className="h-4 w-4" />{hasPermission("performance", "edit") ? "Everyone's reports" : "Your team's reports"}
            </h2>
            <div className="space-y-1.5">
              <Label htmlFor="teammonth" className="text-xs text-muted-foreground">Month</Label>
              <Input id="teammonth" type="month" className="h-8 w-[150px]" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
          </div>
          {teamLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : !team?.data.length ? (
            <Card className="p-10 text-center text-muted-foreground">Nothing filed{month ? ` for ${fmtMonth(month)}` : ""} yet.</Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {team.data.map((r) => <ReportCard key={r._id} r={r} showEmployee />)}
            </div>
          )}
        </div>
      )}

      <PerformanceReportDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
