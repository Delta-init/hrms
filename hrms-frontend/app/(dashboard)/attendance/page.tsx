"use client";
import { useState } from "react";
import { CalendarCheck, Plus, MoreHorizontal, Pencil, Trash2, LogIn, LogOut, ListChecks, CalendarRange, CalendarDays, ShieldAlert, Monitor, Globe, MapPin } from "lucide-react";
import { useAttendance, useDeleteAttendance, useBulkSetAttendanceStatus } from "@/hooks/useAttendance";
import { useAuth } from "@/hooks/useAuth";
import { useTableQuery } from "@/hooks/useTableQuery";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { AttendanceDialog } from "@/components/attendance/AttendanceDialog";
import { AttendanceCalendar } from "@/components/attendance/AttendanceCalendar";
import { AttendanceDayView } from "@/components/attendance/AttendanceDayView";
import { AttendanceStatsBar } from "@/components/attendance/AttendanceStatsBar";
import { DateRangeFilter } from "@/components/shared/DateRangeFilter";
import { useOrgTimeZone } from "@/hooks/useOrgTimeZone";
import { dayKeyIn } from "@/lib/dateRange";
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
import { ATTENDANCE_STATUS_LABELS, DEVICE_ANOMALY_LABELS, type Attendance, type AttendanceStatus } from "@/types";

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
  // Separate snapshot of *today's* records for the animated stats band. Today
  // is the organization's day, not the viewer's — asking in UTC returned an
  // empty band for anyone east of Greenwich.
  const orgTz = useOrgTimeZone();
  const today = dayKeyIn(new Date(), orgTz);
  const { data: todayData, isLoading: todayLoading } = useAttendance({ dateFrom: today, dateTo: today, limit: "500" });
  const { mutate: remove, isPending: deleting } = useDeleteAttendance();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<Attendance | null>(null);
  const [tab, setTab] = useState("records");
  /** Rows ticked for a bulk change — distinct from `selected`, the row being edited. */
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const bulkStatus = useBulkSetAttendanceStatus();
  const tabs = [
    { key: "records", label: "Records", icon: ListChecks },
    { key: "day", label: "Day view", icon: CalendarDays },
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
    {
      id: "status", label: "Status", sortKey: "status",
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[r.status])}>
            {ATTENDANCE_STATUS_LABELS[r.status]}
          </span>
          {/* Beside the status rather than replacing it: the day still counts
              as whatever it counts as, it is only the device it was punched
              from that wants a second look. Same badge as the day view, so a
              flagged day looks the same whichever tab you find it on. */}
          {r.deviceAnomaly && (
            <span
              title={`${DEVICE_ANOMALY_LABELS[r.deviceAnomaly]}${r.deviceLabel ? ` — ${r.deviceLabel}` : ""}`}
              className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400"
            >
              {/* The machine, not the word "Device". "It was not their computer"
                  is a question; "it came from Chrome on Windows" is something
                  somebody can act on without opening the record. */}
              <ShieldAlert className="h-3 w-3" />{r.deviceLabel || "Unknown device"}
            </span>
          )}
        </span>
      ),
    },
    {
      id: "device", label: "Device",
      render: (r) => r.punchDevice
        ? <span className="inline-flex items-center gap-1 text-muted-foreground"><Monitor className="h-3.5 w-3.5" />{r.punchDevice}</span>
        : <span className="text-muted-foreground">—</span>,
    },
    {
      id: "ip", label: "IP",
      render: (r) => r.punchIp
        ? <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground"><Globe className="h-3.5 w-3.5" />{r.punchIp}</span>
        : <span className="text-muted-foreground">—</span>,
    },
    {
      /**
       * Two very different things, never shown as if they were one.
       *
       * GPS is where the phone was, to within metres. A city derived from the
       * IP is a guess the database itself rates as good to 200km — a mobile
       * carrier's addresses are registered where the gateway is, not where the
       * handset is, which is why a punch from Kerala reads as Delhi. Showing
       * that unqualified invites somebody to challenge an employee over a
       * number that never claimed to be their location.
       */
      id: "location", label: "Location",
      render: (r) => {
        const c = r.punchCoords;
        // Precise, and the only one worth calling a location.
        if (c) {
          return (
            <a
              href={`https://www.google.com/maps?q=${c.latitude},${c.longitude}`}
              target="_blank" rel="noopener noreferrer"
              title={`${c.latitude}, ${c.longitude}${r.punchPlace ? ` · the IP suggests ${r.punchPlace}` : ""}`}
              className="inline-flex items-center gap-1 text-foreground hover:underline"
            >
              <MapPin className="h-3.5 w-3.5" />{r.punchPlace ?? `${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}`}
            </a>
          );
        }
        // A guess, and marked as one.
        if (r.punchPlace) {
          return (
            <span
              className="inline-flex items-center gap-1 text-muted-foreground"
              title="Estimated from the IP address — accurate to roughly 200km, and wrong for mobile networks. Not a location."
            >
              <Globe className="h-3.5 w-3.5" />~ {r.punchPlace}
            </span>
          );
        }
        const why = r.punchLocationSource === "denied" ? "Declined"
          : r.punchLocationSource === "unavailable" ? "Unavailable"
          : r.punchLocationSource === "unsupported" ? "Not supported"
          : null;
        return <span className="text-muted-foreground">{why ?? "—"}</span>;
      },
    },
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

      {tab === "day" ? (
        <AttendanceDayView canManage={canManage} />
      ) : tab === "calendar" ? (
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
            searchPlaceholder="Search by name, employee code or email…"
            selectable={canEdit}
            selected={chosen}
            onSelectedChange={setChosen}
            bulkActions={(keys, clear) => (
              <Select
                value=""
                onValueChange={(status) => bulkStatus.mutate({ ids: keys, status }, { onSuccess: clear })}
                disabled={bulkStatus.isPending}
              >
                <SelectTrigger className="h-8 w-[190px]">
                  <SelectValue placeholder={bulkStatus.isPending ? "Updating…" : "Set status…"} />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ATTENDANCE_STATUS_LABELS) as AttendanceStatus[]).map((st) => (
                    <SelectItem key={st} value={st}>{ATTENDANCE_STATUS_LABELS[st]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            filters={filters}
            quickFilters={
              <DateRangeFilter
                from={query.filters.dateFrom}
                to={query.filters.dateTo}
                onChange={({ from, to }) => query.setFilters({ dateFrom: from, dateTo: to })}
                onClear={() => query.setFilters({ dateFrom: undefined, dateTo: undefined })}
              />
            }
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
              // Spelled out rather than a flag: a spreadsheet has no tooltip,
              // and "Device" alone says nothing about what was wrong with it.
              "Device flag": r.deviceAnomaly ? DEVICE_ANOMALY_LABELS[r.deviceAnomaly] : "",
              "Punched from": r.deviceAnomaly ? r.deviceLabel ?? "Unknown device" : "",
              Device: r.punchDevice ?? "",
              IP: r.punchIp ?? "",
              // Kept apart in the export for the same reason as on screen: one
              // is a measurement, the other an estimate with a 200km radius.
              "GPS location": r.punchCoords ? `${r.punchCoords.latitude}, ${r.punchCoords.longitude}` : "",
              "Estimated from IP": r.punchPlace ?? "",
              "Location status": r.punchCoords ? "GPS" : r.punchLocationSource === "denied" ? "Declined by employee" : r.punchLocationSource === "unavailable" ? "Unavailable" : r.punchPlace ? "IP estimate only" : "",
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
