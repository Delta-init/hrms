"use client";
import { Suspense, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useEmployee } from "@/hooks/useEmployees";
import { useUser } from "@/hooks/useUsers";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { EmployeeProfileSections } from "@/components/employees/EmployeeProfileSections";
import { EmployeeAdminControls } from "@/components/employees/EmployeeAdminControls";
import { EmployeeDocumentsPanel } from "@/components/documents/EmployeeDocumentsPanel";
import { AvatarUploader } from "@/components/shared/AvatarUploader";
import { FaceEnrollmentPanel } from "@/components/face/FaceEnrollmentPanel";
import { TITLE_LABELS, type Employee } from "@/types";

const deptName = (e: Employee) => (e.department && typeof e.department === "object" ? e.department.name : null);
const idOf = (v: unknown) => (v && typeof v === "object" ? (v as { _id: string })._id : (v as string) || "");

const Spinner = () => <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

/**
 * Suspense boundary for useSearchParams — without one Next refuses to
 * prerender the route at build time.
 */
export default function EmployeeDetailPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <EmployeeDetail />
    </Suspense>
  );
}

function EmployeeDetail() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = String(params.id);
  const { data: e, isLoading } = useEmployee(id);
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("employees", "edit");

  // Someone with a login is read on their user page, which carries the same
  // profile plus their cards, loans, resignation and increments. Redirecting
  // here rather than rewriting every link means the org chart, the dashboard
  // widgets and the employee list all keep working untouched.
  const linkedUserId = e ? idOf(e.user) : "";
  const stayHere = searchParams.get("view") === "employee";
  const wantRedirect = !!linkedUserId && !stayHere;

  // Confirm the account is actually readable before handing over. A login can
  // sit outside the active org — a global administrator with an employee
  // record here, for one — and sending them to a page that 404s would strand
  // them on a permanent spinner with no way back.
  const { data: linkedUser, isLoading: checkingUser } = useUser(wantRedirect ? linkedUserId : "");
  const redirecting = wantRedirect && !!linkedUser;

  useEffect(() => {
    if (redirecting) router.replace(`/users/${linkedUserId}`);
  }, [redirecting, linkedUserId, router]);

  // Hold the spinner through the check so the page doesn't render and jump.
  if (isLoading || !e || (wantRedirect && checkingUser) || redirecting) return <Spinner />;

  return (
    <div>
      <button onClick={() => router.push("/employees")} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Employees</button>

      <Card className="mb-6 overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-primary/15 via-primary/5 to-transparent" />
        <div className="flex flex-col gap-4 px-6 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <AvatarUploader
              name={e.name}
              photoUrl={e.photoUrl}
              employeeId={e._id}
              canEdit={canEdit}
              className="-mt-10 h-20 w-20 rounded-2xl shadow-lg ring-4 ring-card"
              fallbackClassName="rounded-2xl text-2xl"
            />
            <div className="pb-1">
              <h2 className="text-xl font-bold">{e.title ? `${TITLE_LABELS[e.title]} ` : ""}{e.name}</h2>
              <p className="text-sm text-muted-foreground">{e.designation ?? "—"}{deptName(e) ? ` · ${deptName(e)}` : ""} · {e.employeeCode}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <EmployeeAdminControls employee={e} />
          </div>
        </div>
      </Card>

      {/* Reachable only for someone without a login (anyone with one is sent
          to their user page, which carries the same panel), so in practice this
          is the prompt to create the account first. */}
      <div className="mb-6">
        <FaceEnrollmentPanel userId={linkedUserId || null} userName={e.name} />
      </div>

      <EmployeeProfileSections employee={e} canEdit={canEdit} />

      <div className="mt-6">
        <EmployeeDocumentsPanel employeeId={e._id} canEdit={canEdit} />
      </div>
    </div>
  );
}
