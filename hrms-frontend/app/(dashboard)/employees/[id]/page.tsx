"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Trash2, ChevronDown, Check } from "lucide-react";
import { useEmployee, useDeleteEmployee, useUpdateEmployee } from "@/hooks/useEmployees";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmployeeProfileSections } from "@/components/employees/EmployeeProfileSections";
import { EmployeeDocumentsPanel } from "@/components/documents/EmployeeDocumentsPanel";
import { getInitials, cn } from "@/lib/utils";
import {
  EMPLOYEE_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, TITLE_LABELS,
  type Employee, type EmployeeStatus,
} from "@/types";

const statusStyles: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  probation: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  on_leave: "bg-violet-500/10 text-violet-600 border-violet-500/20",
  notice_period: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  terminated: "bg-red-500/10 text-red-600 border-red-500/20",
};
const deptName = (e: Employee) => (e.department && typeof e.department === "object" ? e.department.name : null);

export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const { data: e, isLoading } = useEmployee(id);
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("employees", "edit");
  const canDelete = hasPermission("employees", "delete");
  const { mutate: remove, isPending: deleting } = useDeleteEmployee();
  const { mutate: update, isPending: updatingStatus } = useUpdateEmployee();

  const [deleteOpen, setDeleteOpen] = useState(false);

  if (isLoading || !e) {
    return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div>
      <button onClick={() => router.push("/employees")} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Employees</button>

      <Card className="mb-6 overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-primary/15 via-primary/5 to-transparent" />
        <div className="flex flex-col gap-4 px-6 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <div className="-mt-10 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-primary-foreground shadow-lg ring-4 ring-card">{getInitials(e.name)}</div>
            <div className="pb-1">
              <h2 className="text-xl font-bold">{e.title ? `${TITLE_LABELS[e.title]} ` : ""}{e.name}</h2>
              <p className="text-sm text-muted-foreground">{e.designation ?? "—"}{deptName(e) ? ` · ${deptName(e)}` : ""} · {e.employeeCode}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="capitalize">{EMPLOYMENT_TYPE_LABELS[e.employmentType]}</Badge>
            {canEdit ? (
              <StatusChanger status={e.status} pending={updatingStatus} onChange={(s) => update({ id: e._id, data: { status: s } })} />
            ) : (
              <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[e.status])}>{EMPLOYEE_STATUS_LABELS[e.status]}</span>
            )}
            {canDelete && <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:bg-destructive/5 hover:text-destructive" onClick={() => setDeleteOpen(true)}><Trash2 className="h-3.5 w-3.5" />Delete</Button>}
          </div>
        </div>
      </Card>

      <EmployeeProfileSections employee={e} canEdit={canEdit} />

      <div className="mt-6">
        <EmployeeDocumentsPanel employeeId={e._id} canEdit={canEdit} />
      </div>

      <ConfirmDialog
        open={deleteOpen} onOpenChange={setDeleteOpen}
        title="Delete employee" description={`${e.name} (${e.employeeCode}) will be permanently removed.`}
        isPending={deleting}
        onConfirm={() => remove(e._id, { onSuccess: () => router.push("/employees") })}
      />
    </div>
  );
}

/** Inline status pill that opens a dropdown to change employment status. */
function StatusChanger({ status, pending, onChange }: {
  status: EmployeeStatus; pending: boolean; onChange: (s: EmployeeStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={pending}>
        <button className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80", statusStyles[status])}>
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {EMPLOYEE_STATUS_LABELS[status]}
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(Object.keys(EMPLOYEE_STATUS_LABELS) as EmployeeStatus[]).map((s) => (
          <DropdownMenuItem key={s} className="cursor-pointer" onClick={() => s !== status && onChange(s)}>
            <span className={cn("mr-2 h-2 w-2 rounded-full", statusStyles[s].split(" ")[0])} />
            {EMPLOYEE_STATUS_LABELS[s]}
            {s === status && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
