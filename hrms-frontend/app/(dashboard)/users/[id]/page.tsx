"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Mail, ContactRound, User2, CreditCard, BookUser, ArrowUpRight, LogOut, Banknote, TrendingUp, FolderOpen, Boxes } from "lucide-react";
import Link from "next/link";
import { useUser } from "@/hooks/useUsers";
import { useEmployeeByUser } from "@/hooks/useEmployees";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/shared/Tabs";
import { EmployeeProfileSections } from "@/components/employees/EmployeeProfileSections";
import { EmployeeDialog } from "@/components/employees/EmployeeDialog";
import { EmployeeResignation } from "@/components/resignations/EmployeeResignation";
import { EmployeeLoans } from "@/components/loans/EmployeeLoans";
import { EmployeeIncrements } from "@/components/salary/EmployeeIncrements";
import { UserCards } from "@/components/cards/UserCards";
import { EmployeeAssets } from "@/components/assets/EmployeeAssets";
import { EmployeeDocumentsPanel } from "@/components/documents/EmployeeDocumentsPanel";
import { FaceEnrollmentPanel } from "@/components/face/FaceEnrollmentPanel";
import { OtherDocumentsPanel } from "@/components/documents/OtherDocumentsPanel";
import { EmployeeAdminControls } from "@/components/employees/EmployeeAdminControls";
import { cn } from "@/lib/utils";
import { AvatarUploader } from "@/components/shared/AvatarUploader";

const statusStyles: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  inactive: "bg-muted text-muted-foreground border-border",
  invited: "bg-amber-500/10 text-amber-600 border-amber-500/20",
};

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const { data: user, isLoading } = useUser(id);
  const { data: employee, isLoading: empLoading } = useEmployeeByUser(id);
  const { hasPermission } = useAuth();
  const canEditEmployee = hasPermission("employees", "edit");
  const canCreateEmployee = hasPermission("employees", "create");
  const canViewCards = hasPermission("cards", "view");
  const canViewAssets = hasPermission("assets", "view");
  const canViewResignations = hasPermission("resignations", "view");
  const canViewLoans = hasPermission("loans", "view");
  const canViewIncrements = hasPermission("salaryIncrements", "view");

  const [tab, setTab] = useState("profile");
  const [createEmpOpen, setCreateEmpOpen] = useState(false);

  if (isLoading) {
    return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  // Deleted, or outside the organization being viewed. Previously this fell
  // through to the same spinner as loading and simply span forever; the linked
  // employee is still reachable, so offer that instead of a dead end.
  if (!user) {
    return (
      <Card className="p-12 text-center">
        <ContactRound className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">This login isn&apos;t available here</p>
        <p className="mt-1 text-sm text-muted-foreground">
          It may have been removed, or it belongs to a different organization.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {employee && (
            <Button variant="outline" asChild>
              <Link href={`/employees/${employee._id}?view=employee`}>Open employee record</Link>
            </Button>
          )}
          <Button onClick={() => router.push("/users")}>Back to users</Button>
        </div>
      </Card>
    );
  }

  const roleName = typeof user.role === "object" ? user.role.roleName : "—";
  const tabs = [
    { key: "profile", label: "Profile", icon: User2 },
    { key: "documents", label: "Passport & Visa", icon: BookUser },
    { key: "files", label: "Documents", icon: FolderOpen },
    canViewResignations && { key: "resignation", label: "Resignation", icon: LogOut },
    canViewLoans && { key: "loans", label: "Loans", icon: Banknote },
    canViewIncrements && { key: "increments", label: "Increments", icon: TrendingUp },
    canViewCards && { key: "cards", label: "Cards", icon: CreditCard },
    canViewAssets && { key: "assets", label: "Assets", icon: Boxes },
  ].filter(Boolean) as { key: string; label: string; icon: React.ElementType }[];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "profile";

  return (
    <div>
      <button onClick={() => router.push("/users")} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Users</button>

      {/* Hero */}
      <Card className="mb-6 overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-primary/15 via-primary/5 to-transparent" />
        <div className="flex flex-col gap-4 px-6 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-4">
            <AvatarUploader
              name={user.name}
              photoUrl={employee?.photoUrl}
              employeeId={employee?._id}
              canEdit={canEditEmployee && !!employee}
              className="-mt-10 h-20 w-20 rounded-2xl shadow-lg ring-4 ring-card"
              fallbackClassName="rounded-2xl text-2xl"
            />
            <div className="pb-1">
              <h2 className="text-xl font-bold">{user.name}</h2>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Mail className="h-3.5 w-3.5" />{user.email}{user.designation ? ` · ${user.designation}` : ""}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{roleName}</Badge>
            {/* Account status — whether they can sign in. Distinct from the
                employment status the controls beside it change. */}
            <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", statusStyles[user.status] ?? statusStyles.inactive)}>{user.status}</span>
            {employee && <EmployeeAdminControls employee={employee} afterDelete={() => router.push("/users")} />}
          </div>
        </div>
      </Card>

      <Tabs tabs={tabs} value={activeTab} onChange={setTab} />

      {/* Face enrollment hangs off the login rather than the employee record —
          only people with a login have attendance for a face to be matched to. */}
      {activeTab === "profile" && (
        <div className="mb-6">
          <FaceEnrollmentPanel userId={id} userName={user.name} />
        </div>
      )}

      {activeTab === "profile" && (
        empLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : employee ? (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Linked employee · <span className="font-medium text-foreground">{employee.employeeCode}</span></p>
              <Link href={`/employees/${employee._id}?view=employee`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Employee record <ArrowUpRight className="h-3 w-3" /></Link>
            </div>
            <EmployeeProfileSections employee={employee} canEdit={canEditEmployee} variant="core" />
          </div>
        ) : (
          <Card className="p-12 text-center">
            <ContactRound className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No employee profile yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create an employee record for this user to capture their full details.</p>
            {canCreateEmployee && (
              <Button className="mt-4" onClick={() => setCreateEmpOpen(true)}><ContactRound className="h-4 w-4" />Create employee profile</Button>
            )}
          </Card>
        )
      )}

      {activeTab === "documents" && (
        empLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : employee ? (
          <div className="space-y-6">
            <EmployeeProfileSections employee={employee} canEdit={canEditEmployee} variant="documents" />
            {/* Credentials beyond the fixed four, alongside them rather than
                buried in the file list. */}
            <OtherDocumentsPanel employeeId={employee._id} canEdit={canEditEmployee} />
          </div>
        ) : (
          <Card className="p-12 text-center">
            <BookUser className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No employee profile yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create the employee profile first (Profile tab) to add passport &amp; visa details.</p>
          </Card>
        )
      )}

      {activeTab === "files" && (
        empLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : employee ? (
          <EmployeeDocumentsPanel employeeId={employee._id} canEdit={canEditEmployee} />
        ) : (
          <Card className="p-12 text-center">
            <FolderOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No employee profile yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create the employee profile first (Profile tab) to file their documents.</p>
          </Card>
        )
      )}

      {activeTab === "resignation" && canViewResignations && (
        empLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : employee ? (
          <EmployeeResignation employee={employee} />
        ) : (
          <Card className="p-12 text-center">
            <LogOut className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No employee profile yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create the employee profile first (Profile tab) to record a resignation.</p>
          </Card>
        )
      )}

      {activeTab === "loans" && canViewLoans && (
        empLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : employee ? (
          <EmployeeLoans employee={employee} />
        ) : (
          <Card className="p-12 text-center">
            <Banknote className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No employee profile yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create the employee profile first (Profile tab) to record loans.</p>
          </Card>
        )
      )}

      {activeTab === "increments" && canViewIncrements && (
        empLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : employee ? (
          <EmployeeIncrements employee={employee} />
        ) : (
          <Card className="p-12 text-center">
            <TrendingUp className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No employee profile yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create the employee profile first (Profile tab) to record increments.</p>
          </Card>
        )
      )}

      {activeTab === "cards" && canViewCards && <UserCards userId={id} />}

      {/* Keyed on the employee record — an asset is issued to a person, not to
          a login, so somebody with no employee profile can hold nothing. */}
      {activeTab === "assets" && canViewAssets && (
        empLoading
          ? <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          : <EmployeeAssets employeeId={employee?._id ?? null} />
      )}

      <EmployeeDialog open={createEmpOpen} onOpenChange={setCreateEmpOpen} defaultName={user.name} defaultUserId={id} />
    </div>
  );
}
