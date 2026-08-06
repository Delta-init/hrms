"use client";
import { useState } from "react";
import { CalendarCheck, Plus, MoreHorizontal, Pencil, Trash2, LogIn, LogOut, ListChecks, CalendarRange } from "lucide-react";
import { useAttendance, useDeleteAttendance } from "@/hooks/useAttendance";
import { useAuth } from "@/hooks/useAuth";
import { useTableQuery } from "@/hooks/useTableQuery";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { AttendanceDialog } from "@/components/attendance/AttendanceDialog";
import { AttendanceCalendar } from "@/components/attendance/AttendanceCalendar";
import { AttendanceStatsBar } from "@/components/attendance/AttendanceStatsBar";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserSelect } from "@/components/pickers";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials, cn } from "@/lib/utils";
import { ATTENDANCE_STATUS_LABELS, type Attendance, type AttendanceStatus } from "@/types";

const ALL = "__all__";
const statusStyles: Record<AttendanceStatus, string> = {
  present: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  wfh: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  late: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  half_day: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  on_leave: "bg-violet-500/10 text-violet-600 border-violet-500/20",
  holiday: "bg-primary/10 text-primary border-primary/20",
  weekend: "bg-muted text-muted-foreground border-border",
  absent: "bg-red-500/10 text-red-600 border-red-500/20",
};
const fmtTime = (iso?: string | null, tz?: string) => (iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso)) : "—");
const fmtDate = (iso: string, tz?: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: tz }).format(new Date(iso));
const fmtWorked = (m: number) => (m > 0 ? `${Math.floor(m / 60)}h ${m % 60}m` : "—");

export default function AttendancePage() {
  const { hasPermission } = useAuth();
  // `edit` is the manager-level flag: recording attendance for someone else,
  // and browsing/filtering by employee, are admin actions. Plain Employees
  // only ever see their own records (enforced server-side too).
  const canManage = hasPermission("attendance", "edit");
  const canEdit = hasPermission("attendance", "edit");
  const canDelete = hasPermission("attendance", "delete");

  const query = useTableQuery({ defaultSortBy: "date", defaultSortOrder: "desc" });
  const { data, isLoading, isFetching } = useAttendance(query.params);
  // Separate snapshot of *today's* records for the animated stats band.
  const today = new Date().toISOString().slice(0, 10);
  const { data: todayData, isLoading: todayLoading } = useAttendance({ dateFrom: today, dateTo: today, limit: "500" });
  const { mutate: remove, isPending: deleting } = useDeleteAttendance();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<Attendance | null>(null);
  const [tab, setTab] = useState("records");
  const tabs = [
    { key: "records", label: "Records", icon: ListChecks },
    { key: "calendar", label: "Calendar", icon: CalendarRange },
  ];

  const columns: DataTableColumn<Attendance>[] = [
    {
      id: "employee", label: "Employee", alwaysVisible: true,
      render: (r) => {
        const name = r.user && typeof r.user === "object" ? r.user.name : "—";
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{getInitials(name)}</div>
            <span className="font-medium">{name}</span>
          </div>
        );
      },
    },
    { id: "date", label: "Date", sortKey: "date", render: (r) => <span className="text-muted-foreground">{fmtDate(r.date, r.timeZone)}</span> },
    { id: "region", label: "Region", defaultVisible: false, render: (r) => <span className="text-xs text-muted-foreground">{r.timeZone}</span> },
    { id: "login", label: "Login", render: (r) => <span className="inline-flex items-center gap-1 text-emerald-600"><LogIn className="h-3.5 w-3.5" />{fmtTime(r.checkIn, r.timeZone)}</span> },
    { id: "logout", label: "Logout", render: (r) => <span className="inline-flex items-center gap-1 text-rose-500"><LogOut className="h-3.5 w-3.5" />{fmtTime(r.checkOut, r.timeZone)}</span> },
    { id: "worked", label: "Worked", sortKey: "workedMinutes", render: (r) => <span className="font-medium">{fmtWorked(r.workedMinutes)}</span> },
    { id: "status", label: "Status", sortKey: "status", render: (r) => <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[r.status])}>{ATTENDANCE_STATUS_LABELS[r.status]}</span> },
    {
      id: "actions", label: "", alwaysVisible: true, align: "right",
      render: (r) => (canEdit || canDelete) ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit && <DropdownMenuItem onClick={() => { setSelected(r); setDialogOpen(true); }} className="cursor-pointer"><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>}
            {canDelete && <DropdownMenuItem onClick={() => { setSelected(r); setDeleteOpen(true); }} className="cursor-pointer text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null,
    },
  ];

  const filters = (
    <>
      {canManage && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Employee</Label>
          <UserSelect
            value={query.filters.user}
            onChange={(v) => query.setFilter("user", v)}
            placeholder="All employees"
            allowClear
            className="h-9 w-[170px]"
          />
        </div>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Status</Label>
        <Select value={query.filters.status ?? ALL} onValueChange={(v) => query.setFilter("status", v)}>
          <SelectTrigger className="h-9 w-[140px]"><SelectValue placeholder="All status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All status</SelectItem>
            {(Object.keys(ATTENDANCE_STATUS_LABELS) as AttendanceStatus[]).map((s) => <SelectItem key={s} value={s}>{ATTENDANCE_STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">From</Label>
        <Input type="date" value={query.filters.dateFrom ?? ""} onChange={(e) => query.setFilter("dateFrom", e.target.value)} className="h-9 w-[150px]" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">To</Label>
        <Input type="date" value={query.filters.dateTo ?? ""} onChange={(e) => query.setFilter("dateTo", e.target.value)} className="h-9 w-[150px]" />
      </div>
    </>
  );

  return (
    <div>
      <PageHeader
        title="Attendance"
        description="Record and manage employee check-in / check-out per day."
        icon={CalendarCheck}
        action={canManage && tab === "records" && <Button onClick={() => { setSelected(null); setDialogOpen(true); }} className="shadow-sm"><Plus className="h-4 w-4" />Record Attendance</Button>}
      />

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === "calendar" ? (
        <AttendanceCalendar />
      ) : (
        <>
          <AttendanceStatsBar records={todayData?.data ?? []} loading={todayLoading} />

          <DataTable
            tableId="attendance"
            columns={columns}
            rows={data?.data ?? []}
            rowKey={(r) => r._id}
            loading={isLoading || isFetching}
            pagination={data?.pagination}
            query={query}
            searchable={false}
            filters={filters}
            rowLabel="records"
            emptyText="No attendance records yet."
            minWidth={820}
            exportName="attendance"
            exportMapper={(r) => ({
              Employee: r.user && typeof r.user === "object" ? r.user.name : "",
              Date: fmtDate(r.date, r.timeZone), Region: r.timeZone,
              Login: fmtTime(r.checkIn, r.timeZone), Logout: fmtTime(r.checkOut, r.timeZone),
              "Worked (min)": r.workedMinutes, "Late (min)": r.lateMinutes,
              Status: ATTENDANCE_STATUS_LABELS[r.status],
            })}
          />
        </>
      )}

      <AttendanceDialog open={dialogOpen} onOpenChange={setDialogOpen} attendance={selected} />
      <ConfirmDialog
        open={deleteOpen} onOpenChange={setDeleteOpen}
        title="Delete attendance" description="This attendance record will be permanently removed."
        isPending={deleting}
        onConfirm={() => selected && remove(selected._id, { onSuccess: () => setDeleteOpen(false) })}
      />
    </div>
  );
}
