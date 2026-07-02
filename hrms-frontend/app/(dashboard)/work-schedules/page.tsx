"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { Clock, Plus, Pencil, Trash2, Loader2, Globe, CalendarDays } from "lucide-react";
import { useWorkSchedules, useDeleteWorkSchedule } from "@/hooks/useWorkSchedules";
import { useAuth } from "@/hooks/useAuth";
import { useTableQuery } from "@/hooks/useTableQuery";
import { CardToolbar } from "@/components/shared/CardToolbar";
import { Pagination } from "@/components/shared/Pagination";
import { PageHeader } from "@/components/shared/PageHeader";
import { WorkScheduleDialog } from "@/components/work-schedules/WorkScheduleDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { WEEKDAYS, type WorkSchedule } from "@/types";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } } };

export default function WorkSchedulesPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("workSchedules", "create");
  const canEdit = hasPermission("workSchedules", "edit");
  const canDelete = hasPermission("workSchedules", "delete");

  const query = useTableQuery({ defaultSortBy: "name", defaultSortOrder: "asc", defaultLimit: 12 });
  const { data, isLoading } = useWorkSchedules(query.params);
  const { mutate: remove, isPending: deleting } = useDeleteWorkSchedule();
  const schedules = data?.data ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<WorkSchedule | null>(null);

  return (
    <div>
      <PageHeader
        title="Work Schedules"
        description="Define shift times, region and leave calendar, then assign to employees."
        icon={Clock}
        action={canCreate && (
          <Button onClick={() => { setSelected(null); setDialogOpen(true); }} className="shadow-sm">
            <Plus className="h-4 w-4" />New Schedule
          </Button>
        )}
      />

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

      <WorkScheduleDialog open={dialogOpen} onOpenChange={setDialogOpen} schedule={selected} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete work schedule"
        description="Employees assigned to it must be reassigned first."
        isPending={deleting}
        onConfirm={() => selected && remove(selected._id, { onSuccess: () => setDeleteOpen(false) })}
      />
    </div>
  );
}
