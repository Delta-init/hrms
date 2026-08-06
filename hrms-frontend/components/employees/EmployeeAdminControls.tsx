"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, ChevronDown, Check } from "lucide-react";
import { useDeleteEmployee, useUpdateEmployee } from "@/hooks/useEmployees";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { cn } from "@/lib/utils";
import {
  EMPLOYEE_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS,
  type Employee, type EmployeeStatus,
} from "@/types";

export const employeeStatusStyles: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  probation: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  on_leave: "bg-violet-500/10 text-violet-600 border-violet-500/20",
  notice_period: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  terminated: "bg-red-500/10 text-red-600 border-red-500/20",
};

/**
 * Employment type, status and delete — the controls that act on the employee
 * record itself.
 *
 * Shared because someone with a login is now read on their user page, and these
 * would otherwise be reachable only from the employee page they get redirected
 * away from. Note the status here is employment status (probation, notice
 * period), which is a different thing from the account status shown beside it.
 */
export function EmployeeAdminControls({
  employee, afterDelete,
}: { employee: Employee; afterDelete?: () => void }) {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("employees", "edit");
  const canDelete = hasPermission("employees", "delete");
  const { mutate: remove, isPending: deleting } = useDeleteEmployee();
  const { mutate: update, isPending: updatingStatus } = useUpdateEmployee();
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <Badge variant="outline" className="capitalize">{EMPLOYMENT_TYPE_LABELS[employee.employmentType]}</Badge>

      {canEdit ? (
        <StatusChanger
          status={employee.status}
          pending={updatingStatus}
          onChange={(s) => update({ id: employee._id, data: { status: s } })}
        />
      ) : (
        <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", employeeStatusStyles[employee.status])}>
          {EMPLOYEE_STATUS_LABELS[employee.status]}
        </span>
      )}

      {canDelete && (
        <Button
          variant="outline" size="sm"
          className="gap-1.5 text-destructive hover:bg-destructive/5 hover:text-destructive"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />Delete
        </Button>
      )}

      <ConfirmDialog
        open={deleteOpen} onOpenChange={setDeleteOpen}
        title="Delete employee"
        description={`${employee.name} (${employee.employeeCode}) will be permanently removed.`}
        isPending={deleting}
        onConfirm={() =>
          remove(employee._id, { onSuccess: () => (afterDelete ? afterDelete() : router.push("/employees")) })
        }
      />
    </>
  );
}

/** Inline status pill that opens a dropdown to change employment status. */
function StatusChanger({ status, pending, onChange }: {
  status: EmployeeStatus; pending: boolean; onChange: (s: EmployeeStatus) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={pending}>
        <button className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80", employeeStatusStyles[status])}>
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {EMPLOYEE_STATUS_LABELS[status]}
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(Object.keys(EMPLOYEE_STATUS_LABELS) as EmployeeStatus[]).map((s) => (
          <DropdownMenuItem key={s} className="cursor-pointer" onClick={() => s !== status && onChange(s)}>
            <span className={cn("mr-2 h-2 w-2 rounded-full", employeeStatusStyles[s].split(" ")[0])} />
            {EMPLOYEE_STATUS_LABELS[s]}
            {s === status && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
