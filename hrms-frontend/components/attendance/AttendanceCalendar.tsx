"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, User2, Users, CalendarDays } from "lucide-react";
import { useAttendanceCalendar } from "@/hooks/useAttendance";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmployeeSelect } from "@/components/pickers";
import { useEmployees } from "@/hooks/useEmployees";
import { cn } from "@/lib/utils";
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
  absent: { label: "Absent", cell: "bg-red-500 text-white", letter: "A" },
  on_leave: { label: "On leave", cell: "bg-sky-500 text-white", letter: "LV" },
  holiday: { label: "Holiday", cell: "bg-violet-500 text-white", letter: "H" },
  weekend: { label: "Weekend", cell: "bg-muted text-muted-foreground", letter: "O" },
  wfh: { label: "WFH", cell: "bg-teal-500 text-white", letter: "W" },
};

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
          </div>
        )}
      </Card>

      {isLoading || isFetching ? (
        <Card className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>
      ) : effectiveMode === "single" ? (
        <SingleView data={data} y={y} monthIndex={mm - 1} month={month} employeeSelected={canManage ? !!employeeId : true} />
      ) : (
        <AllView data={data} month={month} />
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

function SingleView({ data, y, monthIndex, month, employeeSelected }: { data?: { daysInMonth: number; employees: { employee: { name: string }; days: Record<string, AttendanceCalendarDay>; summary: Record<string, number> }[] }; y: number; monthIndex: number; month: string; employeeSelected: boolean }) {
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

  const s = emp.summary;
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
              return (
                <button key={i} onClick={() => day && setSelected(key)} disabled={!day}
                  className={cn("relative flex aspect-square flex-col items-center justify-center rounded-md text-xs font-medium transition", st ? st.cell : "bg-muted/40 text-muted-foreground", day && "cursor-pointer hover:ring-2 hover:ring-primary/40", selected === key && "ring-2 ring-primary")}>
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
        {sel ? (
          <>
            <div className="mb-3 flex items-center gap-2">
              <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold", STATUS[sel.status].cell)}>{STATUS[sel.status].letter}</span>
              <div><p className="text-sm font-semibold">{new Date(selected + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}</p><p className="text-[11px] text-muted-foreground">{STATUS[sel.status].label}</p></div>
            </div>
            <div className="space-y-2.5 text-sm">
              <Row k="Check in" v={fmtTime(sel.checkIn, sel.timeZone)} />
              <Row k="Check out" v={fmtTime(sel.checkOut, sel.timeZone)} />
              <Row k="Worked hours" v={fmtWorked(sel.workedMinutes)} />
              <Row k="Late by" v={sel.lateMinutes ? `${sel.lateMinutes} min` : "—"} />
              {sel.note && <Row k="Note" v={sel.note} />}
              {sel.leave && (
                <Row k="Leave" v={`${sel.leave.label}${sel.leave.paid ? "" : " · unpaid"}`} />
              )}
              {sel.regularization && (
                <Row
                  k="Correction"
                  v={`${REGULARIZATION_TYPE_LABELS[sel.regularization.type]} · ${sel.regularization.status}${
                    sel.regularization.resultingStatus
                      ? ` → ${ATTENDANCE_STATUS_LABELS[sel.regularization.resultingStatus]}`
                      : ""
                  }`}
                />
              )}
            </div>
          </>
        ) : (
          <div className="py-10 text-center text-sm text-muted-foreground"><CalendarDays className="mx-auto mb-2 h-7 w-7" />Select a day to see details.</div>
        )}
      </Card>
    </div>
  );
}

function AllView({ data, month }: { data?: { daysInMonth: number; employees: { employee: { _id: string; name: string }; days: Record<string, AttendanceCalendarDay> }[] }; month: string }) {
  const employees = data?.employees ?? [];
  const dayNums = useMemo(() => Array.from({ length: data?.daysInMonth ?? 30 }, (_, i) => i + 1), [data?.daysInMonth]);
  if (employees.length === 0) return <Card className="py-16 text-center text-sm text-muted-foreground">No employees.</Card>;

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
            {employees.map((e) => (
              <tr key={e.employee._id}>
                <td className="sticky left-0 z-10 whitespace-nowrap bg-card pr-2 text-xs font-medium">{e.employee.name}</td>
                {dayNums.map((d) => {
                  const key = `${month}-${String(d).padStart(2, "0")}`;
                  const day = e.days[key];
                  const st = day ? STATUS[day.status] : undefined;
                  return <td key={d}><div title={day ? `${d}: ${st?.label}` : `${d}`} className={cn("flex h-5 w-5 items-center justify-center rounded text-[8px] font-bold", st ? st.cell : "bg-muted/50")}>{st?.letter}</div></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const Stat = ({ label, value, tone }: { label: string; value: string | number; tone?: string }) => (
  <Card className="p-3"><p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p><p className={cn("mt-0.5 text-lg font-bold tabular-nums", tone)}>{value}</p></Card>
);
const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-4 border-b border-border/50 pb-2 last:border-0"><span className="text-muted-foreground">{k}</span><span className="font-medium">{v}</span></div>
);
