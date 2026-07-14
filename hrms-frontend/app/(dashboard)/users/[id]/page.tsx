"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Mail, ContactRound, User2, CreditCard, BookUser, ArrowUpRight, LogOut } from "lucide-react";
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
import { UserCards } from "@/components/cards/UserCards";
import { getInitials, cn } from "@/lib/utils";

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
  const canViewResignations = hasPermission("resignations", "view");

  const [tab, setTab] = useState("profile");
  const [createEmpOpen, setCreateEmpOpen] = useState(false);

  if (isLoading || !user) {
    return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const roleName = typeof user.role === "object" ? user.role.roleName : "—";
  const tabs = [
    { key: "profile", label: "Profile", icon: User2 },
    { key: "documents", label: "Passport & Visa", icon: BookUser },
    canViewResignations && { key: "resignation", label: "Resignation", icon: LogOut },
    canViewCards && { key: "cards", label: "Cards", icon: CreditCard },
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
            <div className="-mt-10 flex h-20 w-20 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-primary-foreground shadow-lg ring-4 ring-card">{getInitials(user.name)}</div>
            <div className="pb-1">
              <h2 className="text-xl font-bold">{user.name}</h2>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Mail className="h-3.5 w-3.5" />{user.email}{user.designation ? ` · ${user.designation}` : ""}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{roleName}</Badge>
            <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", statusStyles[user.status] ?? statusStyles.inactive)}>{user.status}</span>
          </div>
        </div>
      </Card>

      <Tabs tabs={tabs} value={activeTab} onChange={setTab} />

      {activeTab === "profile" && (
        empLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : employee ? (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Linked employee · <span className="font-medium text-foreground">{employee.employeeCode}</span></p>
              <Link href={`/employees/${employee._id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Full employee page <ArrowUpRight className="h-3 w-3" /></Link>
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
          <EmployeeProfileSections employee={employee} canEdit={canEditEmployee} variant="documents" />
        ) : (
          <Card className="p-12 text-center">
            <BookUser className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No employee profile yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create the employee profile first (Profile tab) to add passport &amp; visa details.</p>
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

      {activeTab === "cards" && canViewCards && <UserCards userId={id} />}

      <EmployeeDialog open={createEmpOpen} onOpenChange={setCreateEmpOpen} defaultName={user.name} defaultUserId={id} />
    </div>
  );
}
