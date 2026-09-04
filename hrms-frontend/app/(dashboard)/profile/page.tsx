"use client";
import { Loader2 } from "lucide-react";
import { useMyEmployeeProfile } from "@/hooks/useEmployees";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmployeeProfileSections } from "@/components/employees/EmployeeProfileSections";
import { EmployeeDocumentsPanel } from "@/components/documents/EmployeeDocumentsPanel";
import { MyAgreementsCard } from "@/components/documents/MyAgreementsCard";
import { FaceEnrollmentPanel } from "@/components/face/FaceEnrollmentPanel";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { AvatarUploader } from "@/components/shared/AvatarUploader";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
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
  const { user } = useAuth();

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

      {/* Kept here permanently, unlike the one on the dashboard: this is where
          somebody comes looking for it after dismissing that one, or on a
          second device, so it neither remembers a dismissal nor offers one. */}
      <div className="mb-6">
        <InstallPrompt persistent />
      </div>

      {/* Your own face is yours to set up. It sat only on the admin's view of
          a user before, so the one person who could always be trusted to
          enrol it — you — was the one person with no way to. */}
      {user?._id && (
        <div className="mb-6">
          <FaceEnrollmentPanel userId={user._id} userName={e.name} />
        </div>
      )}

      <EmployeeProfileSections employee={e} canEdit selfService />

      {/* No employeeId — the self-service half of the same panel HR sees on
          the admin employee page, so uploading a passport or a certificate
          works the same way it always has, just reachable from here too. */}
      <div className="mt-6">
        <EmployeeDocumentsPanel canEdit />
      </div>
      <div className="mt-6">
        <MyAgreementsCard />
      </div>
    </div>
  );
}
