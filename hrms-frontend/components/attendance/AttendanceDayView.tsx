"use client";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, LogIn, LogOut, RotateCcw, ShieldAlert, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useAttendanceDaily, useAttendanceById, useDeleteAttendance, useSetDayStatus } from "@/hooks/useAttendance";
import { useAuth } from "@/hooks/useAuth";
import { AttendanceDialog } from "@/components/attendance/AttendanceDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTableQuery } from "@/hooks/useTableQuery";
import { useOrgTimeZone } from "@/hooks/useOrgTimeZone";
import { dayKeyIn } from "@/lib/dateRange";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getInitials, cn } from "@/lib/utils";
import { DEVICE_ANOMALY_LABELS, ATTENDANCE_STATUS_LABELS } from "@/types";
import type { DailyAttendanceRow, DayViewStatus, AttendanceStatus } from "@/types";

/**
 * One day, everybody.
 *
 * The month calendar answers "how has this person's month gone"; this answers
 * "where is everybody today", which is the question a morning actually starts
 * with. Both read the same figures from the same endpoint, so a day the
 * calendar calls absent is called absent here too.
 */

const ALL = "__all__";

/** Every status the day view can show, in the order it reads best. */
const STATUSES: Array<{ key: DayViewStatus; label: string; tone: string; dot: string }> = [
  { key: "present", label: "Present", tone: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20", dot: "bg-emerald-500" },
  { key: "late", label: "Late", tone: "bg-amber-500/10 text-amber-600 border-amber-500/20", dot: "bg-amber-500" },
  { key: "half_day", label: "Half day", tone: "bg-amber-500/10 text-amber-600 border-amber-500/20", dot: "bg-amber-400" },
  { key: "wfh", label: "Work from home", tone: "bg-sky-500/10 text-sky-600 border-sky-500/20", dot: "bg-sky-500" },
  { key: "on_leave", label: "On leave", tone: "bg-violet-500/10 text-violet-600 border-violet-500/20", dot: "bg-violet-500" },
  { key: "absent", label: "Absent", tone: "bg-red-500/10 text-red-600 border-red-500/20", dot: "bg-red-500" },
  { key: "not_marked", label: "Not marked", tone: "bg-orange-500/10 text-orange-600 border-orange-500/20", dot: "bg-orange-400" },
  { key: "holiday", label: "Holiday", tone: "bg-primary/10 text-primary border-primary/20", dot: "bg-primary" },
  { key: "weekend", label: "Weekend", tone: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/40" },
  { key: "not_employed", label: "Not employed", tone: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground/40" },
];
const byStatus = new Map(STATUSES.map((s) => [s.key, s]));

/** The ones worth a headline figure — the rest are noise at the top of a page. */
const HEADLINE: DayViewStatus[] = ["present", "late", "on_leave", "absent", "not_marked"];

const shift = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const fmtTime = (iso?: string | null, tz?: string) =>
  iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz ?? undefined }).format(new Date(iso)) : "—";
const fmtWorked = (m?: number) => (m && m > 0 ? `${Math.floor(m / 60)}h ${m % 60}m` : "—");
const fmtLongDate = (date: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00.000Z`));

export function AttendanceDayView({ canManage }: { canManage: boolean }) {
  const orgTz = useOrgTimeZone();
  const today = dayKeyIn(new Date(), orgTz);
  const [date, setDate] = useState(today);
  const query = useTableQuery({ defaultLimit: 100 });
  const { data, isLoading, isFetching } = useAttendanceDaily(date);
  const { hasPermission } = useAuth();
  const canEdit = canManage && hasPermission("attendance", "edit");
  const canDelete = canManage && hasPermission("attendance", "delete");

  // A row here is a person; only some of them have a record behind them. Those
  // are the ones that can be edited or deleted individually — but the status
  // can be set on any of them, because the server creates what is missing.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const { data: editing, isLoading: loadingRecord } = useAttendanceById(editingId ?? undefined);
  const { mutate: remove, isPending: removing } = useDeleteAttendance();
  const setDayStatus = useSetDayStatus();

  const statusFilter = query.filters.status ?? ALL;
  const rows = useMemo(() => {
    const all = data?.employees ?? [];
    const term = query.debouncedSearch.trim().toLowerCase();
    return all.filter((r) => {
      if (statusFilter !== ALL && r.status !== statusFilter) return false;
      if (!term) return true;
      return `${r.employee.name} ${r.employee.employeeCode ?? ""} ${r.employee.designation ?? ""}`.toLowerCase().includes(term);
    });
  }, [data, query.debouncedSearch, statusFilter]);

  const columns: DataTableColumn<DailyAttendanceRow>[] = [
    {
      id: "employee", label: "Employee", alwaysVisible: true,
      render: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {getInitials(r.employee.name)}
          </div>
          <div className="min-w-0">
            <div className="truncate font-medium">{r.employee.name}</div>
            {r.employee.employeeCode && <div className="text-xs text-muted-foreground">{r.employee.employeeCode}</div>}
          </div>
        </div>
      ),
    },
    { id: "designation", label: "Designation", defaultVisible: false, render: (r) => <span className="text-muted-foreground">{r.employee.designation || "—"}</span> },
    {
      id: "status", label: "Status", alwaysVisible: true,
      render: (r) => {
        const s = byStatus.get(r.status);
        return (
          <span className="inline-flex items-center gap-1.5">
            <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", s?.tone)}>
              {r.leave?.label && (r.status === "on_leave" || r.status === "wfh") ? r.leave.label : s?.label ?? r.status}
            </span>
            {/* Beside the status rather than replacing it: the day still counts
                as present, it is only the device it was punched from that wants
                a second look. */}
            {/* Manager-only, like the equivalent badge on the records tab: the
                machine a punch came from is provenance, and the server withholds
                it from everyone else. */}
            {canManage && r.deviceAnomaly && (
              <span
                title={`${DEVICE_ANOMALY_LABELS[r.deviceAnomaly]}${r.deviceLabel ? ` — ${r.deviceLabel}` : ""}`}
                className="inline-flex items-center gap-1 rounded-full border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400"
              >
                <ShieldAlert className="h-3 w-3" />{r.deviceLabel || "Unknown device"}
              </span>
            )}
          </span>
        );
      },
    },
    { id: "login", label: "Login", render: (r) => <span className="inline-flex items-center gap-1 text-emerald-600"><LogIn className="h-3.5 w-3.5" />{fmtTime(r.checkIn, r.timeZone ?? orgTz)}</span> },
    { id: "logout", label: "Logout", render: (r) => <span className="inline-flex items-center gap-1 text-rose-500"><LogOut className="h-3.5 w-3.5" />{fmtTime(r.checkOut, r.timeZone ?? orgTz)}</span> },
    { id: "worked", label: "Worked", render: (r) => <span className="font-medium">{fmtWorked(r.workedMinutes)}</span> },
    { id: "late", label: "Late by", defaultVisible: false, render: (r) => <span className="text-amber-600">{r.lateMinutes ? `${r.lateMinutes}m` : "—"}</span> },
    {
      id: "note", label: "Note", defaultVisible: false,
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.regularization ? `Correction ${r.regularization.status}` : r.note || "—"}
        </span>
      ),
    },
    {
      // Only where a record exists. A day with nothing recorded has nothing to
      // edit or delete, and offering the menu anyway would be offering to act
      // on something that is not there.
      id: "actions", label: "", alwaysVisible: true, align: "right",
      render: (r) => (r.attendanceId && (canEdit || canDelete)) ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit && <DropdownMenuItem onClick={() => setEditingId(r.attendanceId!)} className="cursor-pointer"><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>}
            {canDelete && <DropdownMenuItem onClick={() => setDeletingId(r.attendanceId!)} className="cursor-pointer text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Which day. A stepper rather than only a picker: checking yesterday is
          the most common thing anybody does on this screen. */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
        <Button variant="outline" size="icon" onClick={() => setDate((d) => shift(d, -1))} aria-label="Previous day">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-[150px]" />
        <Button variant="outline" size="icon" onClick={() => setDate((d) => shift(d, 1))} disabled={date >= today} aria-label="Next day">
          <ChevronRight className="h-4 w-4" />
        </Button>
        {date !== today && (
          <Button variant="ghost" size="sm" onClick={() => setDate(today)}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />Today
          </Button>
        )}
        <div className="ml-auto text-sm text-muted-foreground">
          {fmtLongDate(date)}
          {data && <span className="ml-2 text-xs">· {data.total} employee{data.total === 1 ? "" : "s"}</span>}
        </div>
      </div>

      {/* The figures, before the detail. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {HEADLINE.map((key) => {
          const s = byStatus.get(key)!;
          const count = data?.counts[key] ?? 0;
          const active = statusFilter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => query.setFilter("status", active ? ALL : key)}
              className={cn(
                "rounded-2xl border bg-card p-4 text-left shadow-sm transition hover:shadow-md",
                active ? "border-primary ring-1 ring-primary" : "border-border"
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full", s.dot)} />
                <span className="text-xs font-medium text-muted-foreground">{s.label}</span>
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums">{isLoading ? "—" : count}</div>
            </button>
          );
        })}
      </div>

      {/* Unrecorded days are what payroll charges when attendance is mandatory,
          so the number that costs money is said in words, not left to be
          counted off the table. */}
      {!!data?.counts.not_marked && !data.isFuture && (
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 px-4 py-3 text-sm text-orange-700 dark:text-orange-400">
          <strong>{data.counts.not_marked}</strong> {data.counts.not_marked === 1 ? "person has" : "people have"} nothing recorded for this day —
          no attendance, no leave, no holiday.
          {data.isToday
            ? " The day is still going."
            : canEdit
              // Now that the rows can be selected, the warning says how to answer
              // it. A number nobody can act on from where they are reading it is
              // a number they learn to scroll past.
              ? " Tick them below and set a status, or approve leave — otherwise payroll may treat it as a day off."
              : " Until it is recorded or leave is approved, payroll may treat it as a day off."}
        </div>
      )}

      <DataTable
        tableId="attendance_day"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.employee._id}
        loading={isLoading || isFetching}
        query={query}
        searchable
        searchPlaceholder="Search employee…"
        selectable={canEdit}
        selected={chosen}
        onSelectedChange={setChosen}
        /**
         * Everybody the day applies to, recorded or not.
         *
         * This used to require an existing record, which excluded exactly the
         * people the banner above is warning about — the ones with nothing
         * recorded, whom payroll may read as unpaid. Somebody who had not
         * joined yet is still excluded: there is no day to mark.
         */
        isSelectable={(r) => r.status !== "not_employed"}
        bulkActions={(keys, clear) => (
          <Select
            value=""
            onValueChange={(status) => {
              // Addressed by person and day rather than by record id, so the
              // rows with nothing recorded are included — the server creates
              // what is missing and amends what is not. Sending ids would have
              // silently dropped exactly the rows worth acting on.
              const employees = rows
                .filter((r) => keys.includes(r.employee._id) && r.status !== "not_employed")
                .map((r) => r.employee._id);
              if (employees.length) setDayStatus.mutate({ employees, date, status }, { onSuccess: clear });
            }}
            disabled={setDayStatus.isPending}
          >
            <SelectTrigger className="h-8 w-[190px]">
              <SelectValue placeholder={setDayStatus.isPending ? "Updating…" : "Set status…"} />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ATTENDANCE_STATUS_LABELS) as AttendanceStatus[]).map((st) => (
                <SelectItem key={st} value={st}>{ATTENDANCE_STATUS_LABELS[st]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        emptyText={canManage ? "Nobody to show for this day." : "No record for this day."}
        rowLabel="employees"
        minWidth={860}
        quickFilters={
          <Select value={statusFilter} onValueChange={(v) => query.setFilter("status", v)}>
            <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s.key} value={s.key}>
                  {s.label}{data?.counts[s.key] ? ` (${data.counts[s.key]})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        exportMapper={(r) => ({
          Employee: r.employee.name,
          Code: r.employee.employeeCode ?? "",
          Designation: r.employee.designation ?? "",
          Status: byStatus.get(r.status)?.label ?? r.status,
          Login: fmtTime(r.checkIn, r.timeZone ?? orgTz),
          Logout: fmtTime(r.checkOut, r.timeZone ?? orgTz),
          Worked: fmtWorked(r.workedMinutes),
          "Late by": r.lateMinutes ? `${r.lateMinutes}m` : "",
          Note: r.note ?? "",
        })}
        exportName={`attendance-${date}`}
      />

      {/* Opened by id and rendered once the real record has arrived, so the
          form is never filled from a half-built stand-in. */}
      {editingId && editing && (
        <AttendanceDialog
          open
          onOpenChange={(o) => { if (!o) setEditingId(null); }}
          attendance={editing}
        />
      )}
      <ConfirmDialog
        open={!!deletingId}
        onOpenChange={(o) => { if (!o) setDeletingId(null); }}
        title="Delete this attendance record?"
        description="The day goes back to having nothing recorded against it. This cannot be undone."
        confirmLabel="Delete"
        isPending={removing}
        onConfirm={() => {
          if (!deletingId) return;
          remove(deletingId, { onSuccess: () => setDeletingId(null) });
        }}
      />
    </div>
  );
}
