"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, User2, Users, CalendarDays, MousePointerClick, X } from "lucide-react";
import { useAttendanceCalendar, useSetDayStatus, useSetDaysStatus } from "@/hooks/useAttendance";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmployeeSelect } from "@/components/pickers";
import { useEmployees } from "@/hooks/useEmployees";
import { cn } from "@/lib/utils";
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog";
import { WEEKDAYS, REGULARIZATION_TYPE_LABELS, ATTENDANCE_STATUS_LABELS, type AttendanceCalendarDay, type AttendanceStatus } from "@/types";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const curMonth = () => new Date().toISOString().slice(0, 7);
const shiftMonth = (m: string, delta: number) => {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(y, mm - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const fmtWorked = (min?: number) => { const m = min ?? 0; return m > 0 ? `${Math.floor(m / 60)}h ${m % 60}m` : "—"; };
const fmtTime = (iso?: string | null, tz?: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz || undefined }).format(new Date(iso)) : "—";

const STATUS: Record<AttendanceStatus, { label: string; cell: string; letter: string }> = {
  present: { label: "Present", cell: "bg-emerald-500 text-white", letter: "P" },
  late: { label: "Late", cell: "bg-amber-500 text-white", letter: "L" },
  half_day: { label: "Half day", cell: "bg-orange-400 text-white", letter: "½" },
  early_out: { label: "Early out", cell: "bg-yellow-500 text-white", letter: "EO" },
  absent: { label: "Absent", cell: "bg-red-500 text-white", letter: "A" },
  on_leave: { label: "On leave", cell: "bg-sky-500 text-white", letter: "LV" },
  holiday: { label: "Holiday", cell: "bg-violet-500 text-white", letter: "H" },
  weekend: { label: "Weekend", cell: "bg-muted text-muted-foreground", letter: "O" },
  wfh: { label: "WFH", cell: "bg-teal-500 text-white", letter: "W" },
};

/** A picked cell: whose day, and which. */
type CellKey = string; // `${employeeId}|${YYYY-MM-DD}`
const cellKey = (employee: string, date: string): CellKey => `${employee}|${date}`;

/**
 * Multi-select for the calendar. A click toggles one day; a shift-click fills
 * every selectable day between it and the last one clicked in the same row, so
 * a fortnight is two clicks rather than fourteen.
 */
function useCellSelection() {
  const [selected, setSelected] = useState<Set<CellKey>>(new Set());
  const [anchor, setAnchor] = useState<{ employee: string; date: string } | null>(null);
  const clear = () => { setSelected(new Set()); setAnchor(null); };
  const toggle = (employee: string, date: string, shift: boolean, rowDates: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && anchor && anchor.employee === employee) {
        const [a, b] = [anchor.date, date].sort();
        for (const d of rowDates) if (d >= a && d <= b) next.add(cellKey(employee, d));
      } else {
        const k = cellKey(employee, date);
        if (next.has(k)) next.delete(k); else next.add(k);
      }
      return next;
    });
    setAnchor({ employee, date });
  };
  return { selected, toggle, clear };
}

export function AttendanceCalendar() {
  const { hasPermission } = useAuth();
  // Browsing other employees' calendars (single or "All" grid) is a manager
  // action; a plain Employee always sees their own month (enforced server-side
  // regardless of what's requested here — this just keeps the UI honest).
  const canManage = hasPermission("attendance", "edit");
  const [month, setMonth] = useState(curMonth());
  const [mode, setMode] = useState<"single" | "all">("single");
  const [employeeId, setEmployeeId] = useState<string>("");

  // Seed the picker with the first employee so the calendar isn't blank on
  // open. Just one row — the picker itself searches the server.
  const { data: firstEmp } = useEmployees(
    { limit: "1", excludeTerminated: "true" },
    { enabled: canManage && !employeeId }
  );
  useEffect(() => {
    const first = firstEmp?.data?.[0];
    if (canManage && !employeeId && first) setEmployeeId(first._id);
  }, [canManage, employeeId, firstEmp]);

  const { data, isLoading, isFetching } = useAttendanceCalendar(month, canManage ? (mode === "single" ? employeeId || undefined : undefined) : undefined);
  const [y, mm] = month.split("-").map(Number);
  const effectiveMode = canManage ? mode : "single";

  // Picking several days to set at once. Managers only — the same people the
  // single-day "Set status" is offered to. Anything else on screen changing
  // (month, view, employee) empties the selection rather than carry cells
  // the user can no longer see.
  const [selecting, setSelecting] = useState(false);
  const selection = useCellSelection();
  useEffect(() => { selection.clear(); }, [month, mode, employeeId]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleSelecting = () => { setSelecting((v) => !v); selection.clear(); };

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setMonth((m) => shiftMonth(m, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="min-w-[130px] text-center text-sm font-semibold">{MONTHS[mm - 1]} {y}</span>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setMonth((m) => shiftMonth(m, 1))}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" onClick={() => setMonth(curMonth())}>Today</Button>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border p-0.5">
              <button onClick={() => setMode("single")} className={cn("inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium", mode === "single" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}><User2 className="h-4 w-4" />Employee</button>
              <button onClick={() => setMode("all")} className={cn("inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium", mode === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}><Users className="h-4 w-4" />All</button>
            </div>
            {mode === "single" && (
              <EmployeeSelect
                value={employeeId}
                onChange={setEmployeeId}
                placeholder="Select employee"
                className="h-9 w-[200px]"
              />
            )}
            <Button variant={selecting ? "default" : "outline"} size="sm" className="h-9" onClick={toggleSelecting}>
              <MousePointerClick className="h-4 w-4" />{selecting ? "Done selecting" : "Select days"}
            </Button>
          </div>
        )}
      </Card>

      {canManage && selecting && <SelectionBar selected={selection.selected} onClear={selection.clear} />}

      {isLoading || isFetching ? (
        <Card className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>
      ) : effectiveMode === "single" ? (
        <SingleView data={data} y={y} monthIndex={mm - 1} month={month} employeeSelected={canManage ? !!employeeId : true} canManage={canManage}
          selecting={canManage && selecting} selection={selection} />
      ) : (
        <AllView data={data} month={month} canManage={canManage} selecting={canManage && selecting} selection={selection} />
      )}

      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 px-1 text-xs text-muted-foreground">
      {(Object.keys(STATUS) as AttendanceStatus[]).map((s) => (
        <span key={s} className="flex items-center gap-1.5"><span className={cn("flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold", STATUS[s].cell)}>{STATUS[s].letter}</span>{STATUS[s].label}</span>
      ))}
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400 ring-1 ring-black/10" />Correction pending</span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-400 ring-1 ring-black/10" />Approved leave</span>
    </div>
  );
}

type CalendarEmployee = { employee: { _id: string; name: string }; days: Record<string, AttendanceCalendarDay>; summary?: Record<string, number> };
type Selection = ReturnType<typeof useCellSelection>;

/** Selected cells look selected on any colour: an outline, not a fill. */
const selectedRing = "ring-2 ring-primary ring-offset-1 ring-offset-background";

function SingleView({ data, y, monthIndex, month, employeeSelected, canManage, selecting, selection }: { data?: { daysInMonth: number; employees: CalendarEmployee[] }; y: number; monthIndex: number; month: string; employeeSelected: boolean; canManage: boolean; selecting: boolean; selection: Selection }) {
  const emp = data?.employees?.[0];
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { setSelected(null); }, [month, emp?.employee.name]);

  if (!emp) {
    // The calendar is keyed off the employee's linked login (User account) —
    // an employee without one can be picked but never has data, which reads
    // as "nothing happened" unless called out explicitly.
    const message = employeeSelected
      ? "This employee has no linked login, so attendance can't be tracked for them."
      : "No employee selected.";
    return <Card className="py-16 text-center text-sm text-muted-foreground"><CalendarDays className="mx-auto mb-2 h-7 w-7" />{message}</Card>;
  }

  const days = emp.days;
  const firstDay = new Date(y, monthIndex, 1).getDay();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= (data?.daysInMonth ?? 30); d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const rowDates = Object.keys(days).sort();

  const s = emp.summary ?? {};
  const sel = selected ? days[selected] : null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Present" value={s.present ?? 0} />
          <Stat label="Absent" value={s.absent ?? 0} tone="text-red-500" />
          <Stat label="On leave" value={s.on_leave ?? 0} tone="text-sky-600" />
          <Stat label="Avg work" value={fmtWorked(s.avgWorkedMinutes)} />
        </div>
        <Card className="p-4">
          <div className="grid grid-cols-7 gap-1.5 text-center">
            {WEEKDAYS.map((w) => <div key={w} className="text-[10px] font-semibold text-muted-foreground">{w}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const key = `${month}-${String(d).padStart(2, "0")}`;
              const day = days[key];
              const st = day ? STATUS[day.status] : undefined;
              const picked = selecting && selection.selected.has(cellKey(emp.employee._id, key));
              return (
                <button key={i} disabled={!day}
                  onClick={(e) => {
                    if (!day) return;
                    if (selecting) selection.toggle(emp.employee._id, key, e.shiftKey, rowDates);
                    else setSelected(key);
                  }}
                  className={cn("relative flex aspect-square flex-col items-center justify-center rounded-md text-xs font-medium transition", st ? st.cell : "bg-muted/40 text-muted-foreground", day && "cursor-pointer hover:ring-2 hover:ring-primary/40", !selecting && selected === key && "ring-2 ring-primary", picked && selectedRing)}>
                  <span>{d}</span>
                  {st && <span className="text-[9px] font-bold opacity-90">{st.letter}</span>}
                  {/* A correction on this day: amber while it waits, white once
                      applied. Marked on the cell so a disputed day is findable
                      without opening each one. */}
                  {day?.regularization && (
                    <span
                      title={`Correction ${day.regularization.status}`}
                      className={cn("absolute right-1 top-1 h-1.5 w-1.5 rounded-full ring-1 ring-black/10",
                        day.regularization.status === "pending" ? "bg-amber-300" : "bg-white")}
                    />
                  )}
                  {/* Leave the attendance status doesn't already show. */}
                  {day?.leave && day.status !== "on_leave" && day.status !== "wfh" && (
                    <span title={day.leave.label} className="absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full bg-sky-300 ring-1 ring-black/10" />
                  )}
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      <Card className="h-fit p-5">
        {selecting ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <MousePointerClick className="mx-auto mb-2 h-7 w-7" />
            Click days to pick them. Shift-click picks every day in between.
          </div>
        ) : sel && selected ? (
          <DayDetails day={sel} date={selected} employeeId={emp.employee._id} canManage={canManage} />
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground"><CalendarDays className="mx-auto mb-2 h-7 w-7" />Select a day to see details.</div>
        )}
      </Card>
    </div>
  );
}

/**
 * One day, read and changed. The calendar's side panel, and the grid's pop-up
 * when a cell is clicked — the same panel, so the two can never offer
 * different things for the same day.
 */
function DayDetails({ day, date, employeeId, employeeName, canManage }: { day: AttendanceCalendarDay; date: string; employeeId: string; employeeName?: string; canManage: boolean }) {
  const setDayStatus = useSetDayStatus();
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold", STATUS[day.status].cell)}>{STATUS[day.status].letter}</span>
        <div>
          <p className="text-sm font-semibold">
            {employeeName ? `${employeeName} · ` : ""}
            {new Date(date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}
          </p>
          <p className="text-[11px] text-muted-foreground">{STATUS[day.status].label}</p>
        </div>
      </div>
      {canManage && (
        <div className="mb-3 space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground">Set status</label>
          <Select
            value=""
            onValueChange={(status) => setDayStatus.mutate({ employees: [employeeId], date, status })}
            disabled={setDayStatus.isPending}
          >
            <SelectTrigger className="h-9"><SelectValue placeholder="Change status…" /></SelectTrigger>
            <SelectContent>
              {(Object.keys(ATTENDANCE_STATUS_LABELS) as AttendanceStatus[]).map((st) => (
                <SelectItem key={st} value={st}>{ATTENDANCE_STATUS_LABELS[st]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Present fills real check-in/out from the shift when the day
              has no punch of its own (not marked, or a stored absence) —
              a day with a real punch already on it is never touched. */}
          <p className="text-[10px] text-muted-foreground">Setting &quot;Present&quot; on a day with no punch fills it from the employee&apos;s shift.</p>
        </div>
      )}
      <div className="space-y-2.5 text-sm">
        <Row k="Check in" v={fmtTime(day.checkIn, day.timeZone)} />
        <Row k="Check out" v={fmtTime(day.checkOut, day.timeZone)} />
        <Row k="Worked hours" v={fmtWorked(day.workedMinutes)} />
        <Row k="Late by" v={day.lateMinutes ? `${day.lateMinutes} min` : "—"} />
        {day.note && <Row k="Note" v={day.note} />}
        {day.leave && (
          <Row k="Leave" v={`${day.leave.label}${day.leave.paid ? "" : " · unpaid"}`} />
        )}
        {day.regularization && (
          <Row
            k="Correction"
            v={`${REGULARIZATION_TYPE_LABELS[day.regularization.type]} · ${day.regularization.status}${
              day.regularization.resultingStatus
                ? ` → ${ATTENDANCE_STATUS_LABELS[day.regularization.resultingStatus]}`
                : ""
            }`}
          />
        )}
      </div>
    </>
  );
}

/** How many days are picked, and one status for all of them. */
function SelectionBar({ selected, onClear }: { selected: Set<CellKey>; onClear: () => void }) {
  const setDaysStatus = useSetDaysStatus();
  const count = selected.size;
  const people = new Set(Array.from(selected, (k) => k.split("|")[0])).size;
  const apply = (status: string) => {
    const cells = Array.from(selected, (k) => { const [employee, date] = k.split("|"); return { employee, date }; });
    setDaysStatus.mutate({ cells, status }, { onSuccess: onClear });
  };
  return (
    <Card className="sticky top-2 z-20 flex flex-wrap items-center gap-2 border-primary/30 bg-primary/5 p-3">
      <span className="text-sm font-medium">
        {count ? `${count} day${count === 1 ? "" : "s"} selected${people > 1 ? ` · ${people} people` : ""}` : "Click days to select them — shift-click for a range"}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Select value="" onValueChange={apply} disabled={!count || setDaysStatus.isPending}>
          <SelectTrigger className="h-8 w-[170px]">
            {setDaysStatus.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SelectValue placeholder="Set status…" />}
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ATTENDANCE_STATUS_LABELS) as AttendanceStatus[]).map((st) => (
              <SelectItem key={st} value={st}>{ATTENDANCE_STATUS_LABELS[st]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground" onClick={onClear} disabled={!count}>
          <X className="h-3.5 w-3.5" />Clear
        </Button>
      </div>
    </Card>
  );
}

function AllView({ data, month, canManage, selecting, selection }: { data?: { daysInMonth: number; employees: CalendarEmployee[] }; month: string; canManage: boolean; selecting: boolean; selection: Selection }) {
  const employees = data?.employees ?? [];
  const dayNums = useMemo(() => Array.from({ length: data?.daysInMonth ?? 30 }, (_, i) => i + 1), [data?.daysInMonth]);
  const [open, setOpen] = useState<{ employee: string; date: string } | null>(null);
  if (employees.length === 0) return <Card className="py-16 text-center text-sm text-muted-foreground">No employees.</Card>;

  // Read from the live data each render, so the pop-up shows the new status
  // the moment a change comes back rather than what was clicked.
  const openRow = open ? employees.find((e) => e.employee._id === open.employee) : undefined;
  const openDay = open && openRow ? openRow.days[open.date] : undefined;

  return (
    <Card className="overflow-hidden p-4">
      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: "3px" }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card pr-2 text-left text-[10px] font-medium text-muted-foreground">Employee</th>
              {dayNums.map((d) => <th key={d} className="w-6 text-center text-[9px] font-medium text-muted-foreground">{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              const rowDates = Object.keys(e.days).sort();
              return (
                <tr key={e.employee._id}>
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-card pr-2 text-xs font-medium">{e.employee.name}</td>
                  {dayNums.map((d) => {
                    const key = `${month}-${String(d).padStart(2, "0")}`;
                    const day = e.days[key];
                    const st = day ? STATUS[day.status] : undefined;
                    const picked = selecting && selection.selected.has(cellKey(e.employee._id, key));
                    return (
                      <td key={d}>
                        <button
                          type="button"
                          disabled={!day}
                          title={day ? `${d}: ${st?.label}` : `${d}`}
                          onClick={(ev) => {
                            if (!day) return;
                            if (selecting) selection.toggle(e.employee._id, key, ev.shiftKey, rowDates);
                            else setOpen({ employee: e.employee._id, date: key });
                          }}
                          className={cn(
                            "flex h-5 w-5 items-center justify-center rounded text-[8px] font-bold",
                            st ? st.cell : "bg-muted/50",
                            day && "cursor-pointer hover:ring-2 hover:ring-primary/40",
                            picked && selectedRing
                          )}
                        >
                          {st?.letter}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ResponsiveDialog open={!!openDay} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <ResponsiveDialogContent desktopClassName="max-w-sm">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Attendance</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="px-4 pb-4 sm:px-0 sm:pb-0">
            {openDay && open && openRow && (
              <DayDetails day={openDay} date={open.date} employeeId={open.employee} employeeName={openRow.employee.name} canManage={canManage} />
            )}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </Card>
  );
}

const Stat = ({ label, value, tone }: { label: string; value: string | number; tone?: string }) => (
  <Card className="p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className={cn("mt-0.5 text-lg font-bold tabular-nums", tone)}>{value}</p></Card>
);
const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-4 border-b border-border/50 pb-2 last:border-0"><span className="text-muted-foreground">{k}</span><span className="font-medium">{v}</span></div>
);
