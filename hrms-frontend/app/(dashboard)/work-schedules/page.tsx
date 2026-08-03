"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { Clock, Plus, Pencil, Trash2, Loader2, Globe, CalendarDays, ListChecks, CalendarRange, ShieldAlert } from "lucide-react";
import { useWorkSchedules, useDeleteWorkSchedule } from "@/hooks/useWorkSchedules";
import { useRosterAssignments, useDeleteRosterAssignment } from "@/hooks/useRosterAssignments";
import { useAuth } from "@/hooks/useAuth";
import { useTableQuery } from "@/hooks/useTableQuery";
import { CardToolbar } from "@/components/shared/CardToolbar";
import { Pagination } from "@/components/shared/Pagination";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { WorkScheduleDialog } from "@/components/work-schedules/WorkScheduleDialog";
import { AssignRosterDialog } from "@/components/work-schedules/AssignRosterDialog";
import { AttendancePenaltyCard } from "@/components/work-schedules/AttendancePenaltyCard";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getInitials, cn } from "@/lib/utils";
import { WEEKDAYS, type WorkSchedule, type RosterAssignment } from "@/types";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } } };
const fmtDate = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—");
const empOf = (a: RosterAssignment) => (a.employee && typeof a.employee === "object" ? a.employee : null);
const scheduleOf = (a: RosterAssignment) => (a.workSchedule && typeof a.workSchedule === "object" ? a.workSchedule : null);
const isCurrent = (a: RosterAssignment) => {
  const today = new Date().toISOString().slice(0, 10);
  return a.effectiveFrom.slice(0, 10) <= today && (!a.effectiveTo || a.effectiveTo.slice(0, 10) >= today);
};

export default function WorkSchedulesPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("workSchedules", "create");
  const canEdit = hasPermission("workSchedules", "edit");
  const canDelete = hasPermission("workSchedules", "delete");

  const [tab, setTab] = useState("schedules");
  const query = useTableQuery({ defaultSortBy: "name", defaultSortOrder: "asc", defaultLimit: 12 });
  const { data, isLoading } = useWorkSchedules(query.params);
  const { mutate: remove, isPending: deleting } = useDeleteWorkSchedule();
  const schedules = data?.data ?? [];

  const { data: rosterData, isLoading: rosterLoading } = useRosterAssignments({ limit: "200" });
  const roster = rosterData?.data ?? [];
  const { mutate: removeRoster, isPending: deletingRoster } = useDeleteRosterAssignment();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<WorkSchedule | null>(null);

  const [rosterDialog, setRosterDialog] = useState(false);
  const [editRoster, setEditRoster] = useState<RosterAssignment | null>(null);
  const [deleteRosterTarget, setDeleteRosterTarget] = useState<RosterAssignment | null>(null);

  const tabs = [
    { key: "schedules", label: "Schedules", icon: ListChecks },
    { key: "roster", label: "Roster", icon: CalendarRange },
    { key: "penalty", label: "Penalty Rules", icon: ShieldAlert },
  ];

  return (
    <div>
      <PageHeader
        title="Work Schedules"
        description="Define shift times and region, then assign employees to a shift for a date range — including rotations."
        icon={Clock}
        action={
          tab === "schedules"
            ? canCreate && <Button onClick={() => { setSelected(null); setDialogOpen(true); }} className="shadow-sm"><Plus className="h-4 w-4" />New Schedule</Button>
            : tab === "roster"
            ? canCreate && <Button onClick={() => { setEditRoster(null); setRosterDialog(true); }} className="shadow-sm" disabled={schedules.length === 0}><Plus className="h-4 w-4" />Assign Shift</Button>
            : null
        }
      />

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === "schedules" && (
      <>
      <CardToolbar query={query} placeholder="Search work schedules…" />

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : schedules.length === 0 ? (
        <Card className="p-16 text-center text-muted-foreground">No work schedules found.</Card>
      ) : (
        <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {schedules.map((s) => (
            <motion.div key={s._id} variants={item}>
              <Card className="flex h-full flex-col p-5 transition-shadow hover:shadow-lg">
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
                    <Clock className="h-5 w-5" />
                  </div>
                  <Badge variant={s.status === "active" ? "secondary" : "outline"} className="capitalize">{s.status}</Badge>
                </div>

                <h3 className="text-base font-semibold">{s.name}</h3>
                {s.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{s.description}</p>}

                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-4 w-4 shrink-0" />
                    <span className="font-medium text-foreground">{s.loginTime} – {s.logoutTime}</span>
                    <span className="text-xs">· {s.graceMinutes}m grace</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Globe className="h-4 w-4 shrink-0" />
                    <span>{s.timeZone}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <CalendarDays className="h-4 w-4 shrink-0" />
                    <div className="flex gap-1">
                      {WEEKDAYS.map((d, i) => {
                        const half = s.halfDays?.includes(i);
                        const work = s.workDays.includes(i);
                        return (
                          <span key={i} title={half ? "Half day" : work ? "Full day" : "Off"} className={cn(
                            "flex h-5 w-6 items-center justify-center rounded text-[10px] font-medium",
                            half ? "bg-amber-400/15 text-amber-600" : work ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground/50"
                          )}>{d[0]}</span>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {(canEdit || canDelete) && (
                  <div className="mt-4 flex gap-2 border-t border-border pt-4">
                    {canEdit && (
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => { setSelected(s); setDialogOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" />Edit
                      </Button>
                    )}
                    {canDelete && (
                      <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/5 hover:text-destructive" onClick={() => { setSelected(s); setDeleteOpen(true); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}

      {!isLoading && data?.pagination && data.pagination.total > 0 && (
        <Card className="mt-4 overflow-hidden">
          <Pagination pagination={data.pagination} page={query.page} limit={query.limit} onPageChange={query.setPage} onLimitChange={query.setLimit} label="schedules" />
        </Card>
      )}
      </>
      )}

      {tab === "roster" && (
        <Card className="overflow-hidden">
          {schedules.length === 0 && !isLoading && (
            <p className="border-b border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">Create a work schedule first, then assign employees to it here.</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Shift</th>
                  <th className="px-4 py-3 font-medium">From</th>
                  <th className="px-4 py-3 font-medium">To</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rosterLoading ? (
                  <tr><td colSpan={6} className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></td></tr>
                ) : roster.length === 0 ? (
                  <tr><td colSpan={6} className="py-16 text-center text-muted-foreground"><CalendarRange className="mx-auto mb-2 h-7 w-7" />No shift assignments yet.</td></tr>
                ) : roster.map((a) => {
                  const e = empOf(a); const sch = scheduleOf(a); const current = isCurrent(a);
                  return (
                    <tr key={a._id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{getInitials(e?.name ?? "?")}</div>
                          <div className="min-w-0"><p className="truncate font-medium">{e?.name ?? "—"}</p><p className="truncate text-xs text-muted-foreground">{e?.employeeCode ?? ""}</p></div>
                        </div>
                      </td>
                      <td className="px-4 py-3">{sch ? `${sch.name} · ${sch.loginTime}–${sch.logoutTime}` : "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(a.effectiveFrom)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{a.effectiveTo ? fmtDate(a.effectiveTo) : "Open-ended"}</td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", current ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600" : "border-border bg-muted text-muted-foreground")}>
                          {current ? "Current" : a.effectiveFrom.slice(0, 10) > new Date().toISOString().slice(0, 10) ? "Upcoming" : "Past"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canEdit && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditRoster(a); setRosterDialog(true); }}><Pencil className="h-4 w-4" /></Button>}
                          {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteRosterTarget(a)}><Trash2 className="h-4 w-4" /></Button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "penalty" && <AttendancePenaltyCard canEdit={canEdit} />}

      <WorkScheduleDialog open={dialogOpen} onOpenChange={setDialogOpen} schedule={selected} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete work schedule"
        description="This work schedule will be permanently removed. If any employees are still assigned to it, reassign them first."
        isPending={deleting}
        onConfirm={() => selected && remove(selected._id, { onSuccess: () => setDeleteOpen(false) })}
      />

      <AssignRosterDialog open={rosterDialog} onOpenChange={setRosterDialog} assignment={editRoster} />
      <ConfirmDialog
        open={!!deleteRosterTarget}
        onOpenChange={(o) => !o && setDeleteRosterTarget(null)}
        title="Remove shift assignment"
        description="Attendance will fall back to the employee's earlier assignment or default schedule for this period."
        isPending={deletingRoster}
        onConfirm={() => deleteRosterTarget && removeRoster(deleteRosterTarget._id, { onSuccess: () => setDeleteRosterTarget(null) })}
      />
    </div>
  );
}
