"use client";
import { Suspense, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useEmployee } from "@/hooks/useEmployees";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { EmployeeProfileSections } from "@/components/employees/EmployeeProfileSections";
import { EmployeeAdminControls } from "@/components/employees/EmployeeAdminControls";
import { EmployeeDocumentsPanel } from "@/components/documents/EmployeeDocumentsPanel";
import { getInitials } from "@/lib/utils";
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
  const redirecting = !!linkedUserId && !stayHere;

  useEffect(() => {
    if (redirecting) router.replace(`/users/${linkedUserId}`);
  }, [redirecting, linkedUserId, router]);

  if (isLoading || !e || redirecting) return <Spinner />;

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
            <EmployeeAdminControls employee={e} />
          </div>
        </div>
      </Card>

      <EmployeeProfileSections employee={e} canEdit={canEdit} />

      <div className="mt-6">
        <EmployeeDocumentsPanel employeeId={e._id} canEdit={canEdit} />
      </div>
    </div>
  );
}
