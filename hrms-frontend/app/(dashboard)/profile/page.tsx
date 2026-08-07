"use client";
import { Loader2 } from "lucide-react";
import { useMyEmployeeProfile } from "@/hooks/useEmployees";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmployeeProfileSections } from "@/components/employees/EmployeeProfileSections";
import { cn } from "@/lib/utils";
import { AvatarUploader } from "@/components/shared/AvatarUploader";
import { EMPLOYEE_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, TITLE_LABELS, type Employee } from "@/types";

const statusStyles: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  probation: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  on_leave: "bg-violet-500/10 text-violet-600 border-violet-500/20",
  notice_period: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  terminated: "bg-red-500/10 text-red-600 border-red-500/20",
};
const deptName = (e: Employee) => (e.department && typeof e.department === "object" ? e.department.name : null);

export default function MyProfilePage() {
  const { data: e, isLoading, isError } = useMyEmployeeProfile();

  if (isLoading) {
    return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (isError || !e) {
    return <Card className="p-16 text-center text-muted-foreground">No employee profile is linked to your account yet. Contact HR if this looks wrong.</Card>;
  }

  return (
    <div>
      <Card className="mb-6 overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-primary/15 via-primary/5 to-transparent" />
        <div className="flex flex-col gap-4 px-6 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            {/* No employeeId — this writes to the caller's own record, so
                changing your own picture needs no admin permission. */}
            <AvatarUploader
              name={e.name}
              photoUrl={e.photoUrl}
              canEdit
              className="-mt-10 h-20 w-20 rounded-2xl shadow-lg ring-4 ring-card"
              fallbackClassName="rounded-2xl text-2xl"
            />
            <div className="min-w-0 pb-1">
              <h2 className="truncate text-xl font-bold">{e.title ? `${TITLE_LABELS[e.title]} ` : ""}{e.name}</h2>
              <p className="truncate text-sm text-muted-foreground">{e.designation ?? "—"}{deptName(e) ? ` · ${deptName(e)}` : ""} · {e.employeeCode}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline" className="capitalize">{EMPLOYMENT_TYPE_LABELS[e.employmentType]}</Badge>
            <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[e.status])}>{EMPLOYEE_STATUS_LABELS[e.status]}</span>
          </div>
        </div>
      </Card>

      <EmployeeProfileSections employee={e} canEdit selfService />
    </div>
  );
}
