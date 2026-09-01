"use client";
import { useState } from "react";
import Link from "next/link";
import { UserRound, Plus, MoreHorizontal, Pencil, Trash2, KeyRound, ShieldCheck, Eye, ContactRound, ScanFace, House, Building2 } from "lucide-react";
import { useEmployees, useDeleteEmployee } from "@/hooks/useEmployees";
import { useDepartmentsSimple } from "@/hooks/useDepartments";
import { useWorkSchedulesSimple } from "@/hooks/useWorkSchedules";
import { useAuth, useImpersonate } from "@/hooks/useAuth";
import { toast } from "@/lib/toast";
import { useTableQuery } from "@/hooks/useTableQuery";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { useFaceEnrolled, useFaceSettings } from "@/hooks/useFaceEnrollment";
import { EmployeeDialog } from "@/components/employees/EmployeeDialog";
import { CreateLoginDialog } from "@/components/employees/CreateLoginDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DepartmentSelect } from "@/components/pickers";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PersonAvatar } from "@/components/shared/PersonAvatar";
import { EMPLOYMENT_TYPE_LABELS, EMPLOYEE_STATUS_LABELS, EXIT_TYPE_LABELS, WORK_MODE_LABELS, type Employee, type EmployeeStatus, type EmploymentType, type ExitType, type WorkMode } from "@/types";

const ALL = "__all__";

/**
 * "Asia/Kolkata" → "Kolkata".
 *
 * The city is the part anyone here reads: the office it belongs to. The IANA
 * prefix is the same on every row and only makes the column wider. Anything
 * without a region falls back to the name as given rather than to a blank —
 * a zone we do not recognise is still a zone somebody is judged by.
 */
function regionOf(timeZone?: string | null): string {
  if (!timeZone) return "—";
  const city = timeZone.split("/").pop();
  return (city ?? timeZone).replace(/_/g, " ");
}
const statusStyles: Record<EmployeeStatus, string> = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  probation: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  on_leave: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  notice_period: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  terminated: "bg-red-500/10 text-red-600 border-red-500/20",
};

export default function EmployeesPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("employees", "view");
  const canCreate = hasPermission("employees", "create");
  const canEdit = hasPermission("employees", "edit");
  const canDelete = hasPermission("employees", "delete");
  const canImpersonate = hasPermission("users", "edit");
  const impersonate = useImpersonate();

  const doImpersonate = async (userId: string) => {
    try { await impersonate(userId); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not impersonate"); }
  };

  /**
   * Current staff unless you ask otherwise.
   *
   * Sixty of the hundred and fifty-nine people on file have left. Showing them
   * mixed in by default made the register read as twice the size of the company,
   * and there was no way to say "just the people who work here" — "Terminated"
   * could only be asked for, never excluded.
   */
  const query = useTableQuery({
    defaultSortBy: "createdAt",
    defaultSortOrder: "desc",
    defaultFilters: { staff: "current" },
  });
  const { data, isLoading, isFetching } = useEmployees(query.params, { enabled: canView });
  const { data: departments = [] } = useDepartmentsSimple();
  const { data: schedules = [] } = useWorkSchedulesSimple();
  const { data: faceSettings } = useFaceSettings();
  // Only the people on screen, and only when face check-in is switched on.
  const userIdsOnPage = (data?.data ?? [])
    .map((e) => (typeof e.user === "object" && e.user ? e.user._id : (e.user as string | undefined)))
    .filter((id): id is string => !!id);
  const { data: enrolledIds } = useFaceEnrolled(userIdsOnPage, !!faceSettings?.enabled);
  const { mutate: remove, isPending: deleting } = useDeleteEmployee();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [selected, setSelected] = useState<Employee | null>(null);

  if (!canView) {
    return (
      <div>
        <PageHeader title="Employees" description="Manage employee records, departments and schedules." icon={UserRound} />
        <Card className="p-16 text-center text-muted-foreground">You don&apos;t have access to employees.</Card>
      </div>
    );
  }

  const columns: DataTableColumn<Employee>[] = [
    {
      id: "employee", label: "Employee", alwaysVisible: true, sortKey: "name",
      render: (e) => (
        <div className="flex items-center gap-3">
          <PersonAvatar name={e.name} photoUrl={e.photoUrl} className="h-9 w-9" fallbackClassName="text-xs" />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate font-medium">
              <Link href={`/employees/${e._id}`} className="truncate hover:text-primary hover:underline">{e.name}</Link>
              {e.user && <span title="Has login account" className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600"><ShieldCheck className="h-3 w-3" />login</span>}
            </p>
            <p className="truncate text-xs text-muted-foreground">{e.designation || e.email || "—"}</p>
          </div>
        </div>
      ),
    },
    { id: "code", label: "Code", sortKey: "employeeCode", render: (e) => <span className="font-mono text-xs">{e.employeeCode}</span> },
    { id: "department", label: "Department", render: (e) => <span className="text-muted-foreground">{typeof e.department === "object" && e.department ? e.department.name : "—"}</span> },
    { id: "type", label: "Type", render: (e) => <span className="text-muted-foreground">{EMPLOYMENT_TYPE_LABELS[e.employmentType]}</span> },
    {
      id: "workMode", label: "Work mode",
      render: (e) => (e.workMode ?? "office") === "wfh" ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-600 dark:text-violet-400">
          <House className="h-3 w-3" />Home
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          <Building2 className="h-3 w-3" />Office
        </span>
      ),
    },
    {
      // Shown by default, and with the hours and region rather than only the
      // schedule's name: three of the nine schedules are named things like
      // "General Polciy - websign in", and several different names carry
      // identical hours. Attendance is judged on the hours and the zone, so
      // those are what belongs on the row. "Not set" is called out rather than
      // dashed, because it means the person is being judged against a fallback
      // shift nobody chose for them.
      id: "schedule", label: "Schedule",
      render: (e) => {
        const ws = typeof e.workSchedule === "object" ? e.workSchedule : null;
        if (!ws) return <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-500">Not set</span>;
        return (
          <div className="leading-tight">
            <div className="font-medium tabular-nums">{ws.loginTime}–{ws.logoutTime}</div>
            <div className="text-xs text-muted-foreground">{regionOf(ws.timeZone)} · {ws.name}</div>
          </div>
        );
      },
    },
    { id: "joining", label: "Joining", defaultVisible: false, sortKey: "joiningDate", render: (e) => <span className="text-muted-foreground">{e.joiningDate ? new Date(e.joiningDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</span> },
    // Dropped entirely when the recognition service is off, rather than shown
    // as a column of dashes for a feature the server cannot perform.
    ...(faceSettings?.enabled ? [{
      id: "face", label: "Face check-in",
      render: (e: Employee) => {
        const uid = typeof e.user === "object" && e.user ? e.user._id : (e.user as string | undefined);
        // No login means no face: a punch is matched through the account, so
        // "not set up" would read as their omission rather than the system's.
        if (!uid) return <span className="text-xs text-muted-foreground">No login</span>;
        if (!enrolledIds) return <span className="text-xs text-muted-foreground">—</span>;
        return enrolledIds.has(uid) ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <ScanFace className="h-3 w-3" />Enrolled
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            Not set up
          </span>
        );
      },
    }] satisfies DataTableColumn<Employee>[] : []),
    {
      id: "status", label: "Status", sortKey: "status",
      render: (e) => (
        <div className="flex flex-col items-start gap-0.5">
          <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[e.status])}>
            {/* "Terminated" reads the same for somebody who resigned and
                somebody who was dismissed. Where the exit record knows which,
                say which. */}
            {e.status === "terminated" && e.exitType ? EXIT_TYPE_LABELS[e.exitType] : EMPLOYEE_STATUS_LABELS[e.status]}
          </span>
          {e.status === "terminated" && e.lastWorkingDay && (
            <span className="text-[10px] text-muted-foreground">
              until {new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(e.lastWorkingDay))}
            </span>
          )}
        </div>
      ),
    },
    {
      id: "actions", label: "", alwaysVisible: true, align: "right",
      render: (e) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild className="cursor-pointer"><Link href={`/employees/${e._id}`}><ContactRound className="mr-2 h-4 w-4" />View profile</Link></DropdownMenuItem>
            {canEdit && <DropdownMenuItem onClick={() => { setSelected(e); setDialogOpen(true); }} className="cursor-pointer"><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>}
            {canEdit && !e.user && <DropdownMenuItem onClick={() => { setSelected(e); setLoginOpen(true); }} className="cursor-pointer"><KeyRound className="mr-2 h-4 w-4" />Create login</DropdownMenuItem>}
            {canImpersonate && e.user && (
              <DropdownMenuItem onClick={() => doImpersonate(typeof e.user === "object" ? e.user!._id : (e.user as string))} className="cursor-pointer"><Eye className="mr-2 h-4 w-4" />Impersonate</DropdownMenuItem>
            )}
            {canDelete && <DropdownMenuItem onClick={() => { setSelected(e); setDeleteOpen(true); }} className="cursor-pointer text-destructive focus:text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const filters = (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Department</Label>
        <DepartmentSelect
          value={query.filters.department}
          onChange={(v) => query.setFilter("department", v)}
          placeholder="All departments"
          allowClear
          className="h-9 w-[170px]"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Type</Label>
        <Select value={query.filters.employmentType ?? ALL} onValueChange={(v) => query.setFilter("employmentType", v)}>
          <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {(Object.keys(EMPLOYMENT_TYPE_LABELS) as EmploymentType[]).map((t) => <SelectItem key={t} value={t}>{EMPLOYMENT_TYPE_LABELS[t]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Work mode</Label>
        <Select value={query.filters.workMode ?? ALL} onValueChange={(v) => query.setFilter("workMode", v)}>
          <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Anywhere" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Anywhere</SelectItem>
            {(Object.keys(WORK_MODE_LABELS) as WorkMode[]).map((m) => <SelectItem key={m} value={m}>{WORK_MODE_LABELS[m]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Schedule</Label>
        <Select value={query.filters.workSchedule ?? ALL} onValueChange={(v) => query.setFilter("workSchedule", v)}>
          <SelectTrigger className="h-9 w-[210px]"><SelectValue placeholder="Any schedule" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any schedule</SelectItem>
            {/* The one nothing else surfaces: who is still on the fallback. */}
            <SelectItem value="none">Not set</SelectItem>
            {schedules.map((s) => (
              <SelectItem key={s._id} value={s._id}>
                {s.loginTime}–{s.logoutTime} · {regionOf(s.timeZone)} · {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {faceSettings?.enabled && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Face check-in</Label>
          <Select value={query.filters.faceEnrolled ?? ALL} onValueChange={(v) => query.setFilter("faceEnrolled", v)}>
            <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="Anyone" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Anyone</SelectItem>
              <SelectItem value="yes">Enrolled</SelectItem>
              <SelectItem value="no">Not set up</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Staff</Label>
        <Select value={query.filters.staff ?? "all"} onValueChange={(v) => query.setFilter("staff", v)}>
          <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="current">Current staff</SelectItem>
            <SelectItem value="leavers">Leavers</SelectItem>
            <SelectItem value="all">Everyone</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Only meaningful about somebody who has gone, so it is offered only
          when leavers are in view. */}
      {query.filters.staff !== "current" && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">How they left</Label>
          <Select value={query.filters.exitType ?? ALL} onValueChange={(v) => query.setFilter("exitType", v)}>
            <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder="Any reason" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any reason</SelectItem>
              {(Object.keys(EXIT_TYPE_LABELS) as ExitType[]).map((t) => (
                <SelectItem key={t} value={t}>{EXIT_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Status</Label>
        <Select value={query.filters.status ?? ALL} onValueChange={(v) => query.setFilter("status", v)}>
          <SelectTrigger className="h-9 w-[150px]"><SelectValue placeholder="All status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All status</SelectItem>
            {(Object.keys(EMPLOYEE_STATUS_LABELS) as EmployeeStatus[]).map((s) => <SelectItem key={s} value={s}>{EMPLOYEE_STATUS_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </>
  );

  return (
    <div>
      <PageHeader
        title="Employees"
        description="Manage employee records, departments and schedules."
        icon={UserRound}
        action={canCreate && <Button onClick={() => { setSelected(null); setDialogOpen(true); }} className="shadow-sm"><Plus className="h-4 w-4" />Add Employee</Button>}
      />

      <DataTable
        tableId="employees"
        columns={columns}
        rows={data?.data ?? []}
        rowKey={(e) => e._id}
        loading={isLoading || isFetching}
        pagination={data?.pagination}
        query={query}
        searchPlaceholder="Search employees…"
        filters={filters}
        rowLabel="employees"
        emptyText="No employees found."
        exportName="employees"
        exportMapper={(e) => ({
          Code: e.employeeCode, Name: e.name, Email: e.email ?? "", Phone: e.phone ?? "",
          Designation: e.designation ?? "",
          Department: typeof e.department === "object" && e.department ? e.department.name : "",
          Type: EMPLOYMENT_TYPE_LABELS[e.employmentType],
          "Work mode": WORK_MODE_LABELS[e.workMode ?? "office"],
          Schedule: typeof e.workSchedule === "object" && e.workSchedule ? e.workSchedule.name : "Not set",
          "Schedule hours": typeof e.workSchedule === "object" && e.workSchedule ? `${e.workSchedule.loginTime}–${e.workSchedule.logoutTime}` : "",
          "Schedule region": typeof e.workSchedule === "object" && e.workSchedule ? regionOf(e.workSchedule.timeZone) : "",
          Status: e.status === "terminated" && e.exitType ? EXIT_TYPE_LABELS[e.exitType] : EMPLOYEE_STATUS_LABELS[e.status],
          "Last working day": e.lastWorkingDay ? new Date(e.lastWorkingDay).toISOString().slice(0, 10) : "",
          Joining: e.joiningDate ? new Date(e.joiningDate).toISOString().slice(0, 10) : "",
        })}
      />

      <EmployeeDialog open={dialogOpen} onOpenChange={setDialogOpen} employee={selected} />
      <CreateLoginDialog open={loginOpen} onOpenChange={setLoginOpen} employee={selected} />
      <ConfirmDialog
        open={deleteOpen} onOpenChange={setDeleteOpen}
        title="Delete employee" description="This employee record will be permanently removed."
        isPending={deleting}
        onConfirm={() => selected && remove(selected._id, { onSuccess: () => setDeleteOpen(false) })}
      />
    </div>
  );
}
