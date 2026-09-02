"use client";
import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Building2, ChevronLeft, ChevronRight, ArrowLeft, Loader2, FileSpreadsheet, Users as UsersIcon, CalendarClock, CalendarDays,
} from "lucide-react";
import { useDepartmentReport } from "@/hooks/useDepartments";
import { PageHeader } from "@/components/shared/PageHeader";
import { DepartmentApprovals } from "@/components/departments/DepartmentApprovals";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { exportSheetsToExcel } from "@/lib/excel";
import { getInitials, cn } from "@/lib/utils";
import { WEEKDAYS, type AttendanceStatus, type DepartmentReportMember } from "@/types";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const STATUS: Partial<Record<AttendanceStatus, { c: string; l: string }>> = {
  present: { c: "bg-emerald-500", l: "Present" },
  late: { c: "bg-amber-500", l: "Late" },
  half_day: { c: "bg-orange-500", l: "Half Day" },
  absent: { c: "bg-red-500", l: "Absent" },
  on_leave: { c: "bg-violet-500", l: "Leave" },
  wfh: { c: "bg-sky-500", l: "WFH" },
  holiday: { c: "bg-primary", l: "Holiday" },
};
const nowMonth = () => new Date().toISOString().slice(0, 7);
const dayKey = (month: string, d: number) => `${month}-${String(d).padStart(2, "0")}`;

export default function DepartmentReportPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const [month, setMonth] = useState(nowMonth());
  const { data, isLoading } = useDepartmentReport(id, month);
  const [selMember, setSelMember] = useState<string>("");

  const [y, m] = month.split("-").map(Number);
  const shiftMonth = (delta: number) => {
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const members = data?.members ?? [];
  const days = data?.daysInMonth ?? 30;
  const dayNums = useMemo(() => Array.from({ length: days }, (_, i) => i + 1), [days]);

  const member = members.find((mm) => mm.employee._id === selMember) ?? members[0];

  const exportExcel = () => {
    if (!data) return;
    const membersSheet = members.map((mm) => ({
      Name: mm.employee.name, Code: mm.employee.employeeCode, Designation: mm.employee.designation ?? "",
      "Leave Days (yr)": mm.leaveDays, Present: mm.summary.present, Late: mm.summary.late,
      "Half Day": mm.summary.half_day, Absent: mm.summary.absent, "On Leave": mm.summary.on_leave, WFH: mm.summary.wfh,
    }));
    const calSheet = members.map((mm) => {
      const row: Record<string, string> = { Employee: mm.employee.name };
      dayNums.forEach((d) => { const st = mm.calendar[dayKey(month, d)]; row[String(d)] = st ? (STATUS[st]?.l ?? st) : ""; });
      return row;
    });
    exportSheetsToExcel(`${data.department.name}-report-${month}`, [
      { name: "Members", rows: membersSheet },
      { name: "Team Calendar", rows: calSheet },
    ]);
  };

  if (isLoading || !data) {
    return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const leader = typeof data.department.leader === "object" && data.department.leader ? data.department.leader.name : null;

  return (
    <div>
      <button onClick={() => router.push("/departments")} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Departments</button>

      <PageHeader
        title={data.department.name}
        description={`${data.department.memberCount} members${leader ? ` · Led by ${leader}` : ""}${data.department.code ? ` · ${data.department.code}` : ""}`}
        icon={Building2}
        action={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftMonth(-1)}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="min-w-[120px] px-2 text-center text-sm font-medium">{MONTHS[m - 1]} {y}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftMonth(1)}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <Button variant="outline" size="sm" className="gap-2" onClick={exportExcel}><FileSpreadsheet className="h-4 w-4" />Export</Button>
          </div>
        }
      />

      {/* Before the attendance report: a pending decision is something to act
          on now, where the report below is something to read. */}
      <DepartmentApprovals departmentId={id} departmentName={data.department.name} />

      {/* Members table with leave counts */}
      <Card className="mb-6 overflow-hidden">
        <div className="border-b border-border px-5 py-3"><div className="flex items-center gap-2"><UsersIcon className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Members · leave & attendance</h3></div></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-5 py-3 font-semibold">Employee</th>
              <th className="px-5 py-3 text-center font-semibold">Leave (yr)</th>
              <th className="px-5 py-3 text-center font-semibold">Present</th>
              <th className="px-5 py-3 text-center font-semibold">Late</th>
              <th className="px-5 py-3 text-center font-semibold">Half</th>
              <th className="px-5 py-3 text-center font-semibold">Absent</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {members.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-14 text-center text-muted-foreground">No employees in this department.</td></tr>
              ) : members.map((mm) => (
                <tr key={mm.employee._id} className="hover:bg-muted/30">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{getInitials(mm.employee.name)}</div>
                      <div><p className="font-medium">{mm.employee.name}</p><p className="text-xs text-muted-foreground">{mm.employee.employeeCode}{mm.hasUser ? "" : " · no login"}</p></div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-center"><Badge variant="secondary">{mm.leaveDays}</Badge></td>
                  <td className="px-5 py-3 text-center text-emerald-600">{mm.summary.present}</td>
                  <td className="px-5 py-3 text-center text-amber-600">{mm.summary.late}</td>
                  <td className="px-5 py-3 text-center text-orange-600">{mm.summary.half_day}</td>
                  <td className="px-5 py-3 text-center text-red-600">{mm.summary.absent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Member working calendar */}
        <Card className="p-5 xl:col-span-1">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Member calendar</h3></div>
          </div>
          {members.length > 0 && (
            <Select value={member?.employee._id} onValueChange={setSelMember}>
              <SelectTrigger className="mb-3 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>{members.map((mm) => <SelectItem key={mm.employee._id} value={mm.employee._id}>{mm.employee.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {member ? <MemberCalendar month={month} year={y} monthIndex={m - 1} days={days} member={member} /> : <p className="py-8 text-center text-sm text-muted-foreground">No members.</p>}
        </Card>

        {/* Team working calendar matrix */}
        <Card className="p-5 xl:col-span-2">
          <div className="mb-3 flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">Team working calendar · {MONTHS[m - 1]}</h3></div>
          <div className="overflow-x-auto">
            <table className="border-separate" style={{ borderSpacing: "3px" }}>
              <thead><tr>
                <th className="sticky left-0 z-10 bg-background pr-2 text-left text-[10px] font-medium text-muted-foreground">Member</th>
                {dayNums.map((d) => <th key={d} className="w-6 text-center text-[9px] font-medium text-muted-foreground">{d}</th>)}
              </tr></thead>
              <tbody>
                {members.map((mm) => (
                  <tr key={mm.employee._id}>
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-background pr-2 text-xs font-medium">{mm.employee.name.split(" ")[0]}</td>
                    {dayNums.map((d) => {
                      const st = mm.calendar[dayKey(month, d)];
                      const s = st ? STATUS[st] : undefined;
                      return <td key={d}><div title={st ? `${d}: ${s?.l ?? st}` : `${d}`} className={cn("h-5 w-5 rounded", s ? s.c : "bg-muted/60")} /></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {Object.values(STATUS).map((s) => <span key={s!.l} className="flex items-center gap-1.5"><span className={cn("h-3 w-3 rounded", s!.c)} />{s!.l}</span>)}
          </div>
        </Card>
      </div>
    </div>
  );
}

function MemberCalendar({ month, year, monthIndex, days, member }: {
  month: string; year: number; monthIndex: number; days: number; member: DepartmentReportMember;
}) {
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w) => <div key={w} className="text-[10px] font-semibold text-muted-foreground">{w[0]}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const st = member.calendar[`${month}-${String(d).padStart(2, "0")}`];
          const s = st ? STATUS[st] : undefined;
          return (
            <div key={i} title={st ? `${d}: ${s?.l ?? st}` : String(d)}
              className={cn("flex aspect-square items-center justify-center rounded-md text-[11px] font-medium", s ? `${s.c} text-white` : "bg-muted/50 text-muted-foreground")}>
              {d}
            </div>
          );
        })}
      </div>
    </div>
  );
}
