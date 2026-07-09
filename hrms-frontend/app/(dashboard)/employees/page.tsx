"use client";
import { useState } from "react";
import Link from "next/link";
import { UserRound, Plus, MoreHorizontal, Pencil, Trash2, KeyRound, ShieldCheck, Eye, ContactRound } from "lucide-react";
import { useEmployees, useDeleteEmployee } from "@/hooks/useEmployees";
import { useDepartmentsSimple } from "@/hooks/useDepartments";
import { useAuth, useImpersonate } from "@/hooks/useAuth";
import { toast } from "@/lib/toast";
import { useTableQuery } from "@/hooks/useTableQuery";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { EmployeeDialog } from "@/components/employees/EmployeeDialog";
import { CreateLoginDialog } from "@/components/employees/CreateLoginDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials, cn } from "@/lib/utils";
import { EMPLOYMENT_TYPE_LABELS, EMPLOYEE_STATUS_LABELS, type Employee, type EmployeeStatus, type EmploymentType } from "@/types";

const ALL = "__all__";
const statusStyles: Record<EmployeeStatus, string> = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  probation: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  on_leave: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  terminated: "bg-red-500/10 text-red-600 border-red-500/20",
};

export default function EmployeesPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("employees", "create");
  const canEdit = hasPermission("employees", "edit");
  const canDelete = hasPermission("employees", "delete");
  const canImpersonate = hasPermission("users", "edit");
  const impersonate = useImpersonate();

  const doImpersonate = async (userId: string) => {
    try { await impersonate(userId); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not impersonate"); }
  };

  const query = useTableQuery({ defaultSortBy: "createdAt", defaultSortOrder: "desc" });
  const { data, isLoading, isFetching } = useEmployees(query.params);
  const { data: departments = [] } = useDepartmentsSimple();
  const { mutate: remove, isPending: deleting } = useDeleteEmployee();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [selected, setSelected] = useState<Employee | null>(null);

  const columns: DataTableColumn<Employee>[] = [
    {
      id: "employee", label: "Employee", alwaysVisible: true, sortKey: "name",
      render: (e) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{getInitials(e.name)}</div>
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
    { id: "schedule", label: "Schedule", defaultVisible: false, render: (e) => <span className="text-muted-foreground">{typeof e.workSchedule === "object" && e.workSchedule ? e.workSchedule.name : "—"}</span> },
    { id: "joining", label: "Joining", defaultVisible: false, sortKey: "joiningDate", render: (e) => <span className="text-muted-foreground">{e.joiningDate ? new Date(e.joiningDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</span> },
    { id: "status", label: "Status", sortKey: "status", render: (e) => <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[e.status])}>{EMPLOYEE_STATUS_LABELS[e.status]}</span> },
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
        <Select value={query.filters.department ?? ALL} onValueChange={(v) => query.setFilter("department", v)}>
          <SelectTrigger className="h-9 w-[170px]"><SelectValue placeholder="All departments" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All departments</SelectItem>
            {departments.map((d) => <SelectItem key={d._id} value={d._id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
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
          Schedule: typeof e.workSchedule === "object" && e.workSchedule ? e.workSchedule.name : "",
          Status: EMPLOYEE_STATUS_LABELS[e.status],
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
