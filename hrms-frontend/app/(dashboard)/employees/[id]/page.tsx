"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft, Loader2, Pencil, Trash2, User2, Briefcase, Landmark, GraduationCap,
  MapPin, Home, ShieldAlert, Mail, Phone, CalendarDays, Clock3,
} from "lucide-react";
import { useEmployee, useDeleteEmployee } from "@/hooks/useEmployees";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmployeeSectionDialog, type ProfileSection } from "@/components/employees/EmployeeSectionDialog";
import { getInitials, cn } from "@/lib/utils";
import {
  EMPLOYEE_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, TITLE_LABELS, GENDER_LABELS, MARITAL_LABELS,
  type Employee, type EmployeeRef,
} from "@/types";

const statusStyles: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  probation: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  on_leave: "bg-violet-500/10 text-violet-600 border-violet-500/20",
  terminated: "bg-red-500/10 text-red-600 border-red-500/20",
};

const fmtDate = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—");
const nameOf = (r?: EmployeeRef | string | null) => (r && typeof r === "object" ? r.name : null);
const deptName = (e: Employee) => (e.department && typeof e.department === "object" ? e.department.name : null);

/** Auto experience between a start date and now, e.g. "2y 3m". */
function experience(from?: string | null): string {
  if (!from) return "—";
  const s = new Date(from), n = new Date();
  let months = (n.getFullYear() - s.getFullYear()) * 12 + (n.getMonth() - s.getMonth());
  if (n.getDate() < s.getDate()) months -= 1;
  if (months < 0) return "—";
  const y = Math.floor(months / 12), m = months % 12;
  return [y ? `${y}y` : "", m ? `${m}m` : "", !y && !m ? "0m" : ""].filter(Boolean).join(" ");
}

const container = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const item = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } } };

export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const { data: e, isLoading } = useEmployee(id);
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("employees", "edit");
  const canDelete = hasPermission("employees", "delete");
  const { mutate: remove, isPending: deleting } = useDeleteEmployee();

  const [section, setSection] = useState<ProfileSection | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (isLoading || !e) {
    return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const edit = (s: ProfileSection) => (
    canEdit ? <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSection(s)}><Pencil className="h-3.5 w-3.5" />Edit</Button> : null
  );

  return (
    <div>
      <button onClick={() => router.push("/employees")} className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Employees</button>

      {/* Hero */}
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
            <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[e.status])}>{EMPLOYEE_STATUS_LABELS[e.status]}</span>
            {canDelete && <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:bg-destructive/5 hover:text-destructive" onClick={() => setDeleteOpen(true)}><Trash2 className="h-3.5 w-3.5" />Delete</Button>}
          </div>
        </div>
      </Card>

      <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Personal */}
        <Section icon={User2} title="Personal details" action={edit("personal")}>
          <Grid>
            <Item label="Gender" value={e.gender ? GENDER_LABELS[e.gender] : "—"} />
            <Item label="Marital status" value={e.maritalStatus ? MARITAL_LABELS[e.maritalStatus] : "—"} />
            <Item label="Work email" value={e.email ?? "—"} icon={Mail} />
            <Item label="Personal email" value={e.personalEmail ?? "—"} icon={Mail} />
            <Item label="Mobile" value={e.mobileNumber ?? "—"} icon={Phone} />
            <Item label="Date of birth" value={fmtDate(e.dob)} icon={CalendarDays} />
            <Item label="Blood group" value={e.bloodGroup ?? "—"} />
            <Item label="Nationality" value={e.nationality ?? "—"} />
          </Grid>
        </Section>

        {/* Employment */}
        <Section icon={Briefcase} title="Employment details" action={edit("employment")}>
          <Grid>
            <Item label="Department" value={deptName(e) ?? "—"} />
            <Item label="Location" value={e.location ?? "—"} icon={MapPin} />
            <Item label="Reporting to" value={nameOf(e.reportingTo) ?? "—"} />
            <Item label="Currency" value={e.currency ?? "—"} />
            <Item label="Joining date" value={fmtDate(e.joiningDate)} icon={CalendarDays} />
            <Item label="Confirmation date" value={fmtDate(e.confirmationDate)} icon={CalendarDays} />
            <Item label="Probation" value={e.probationPeriodDays ? `${e.probationPeriodDays} days` : "—"} />
            <Item label="Current experience" value={experience(e.joiningDate)} icon={Clock3} accent />
            <Item label="Previous experience" value={e.oldCompanyExperience ?? "—"} full />
          </Grid>
        </Section>

        {/* Bank */}
        <Section icon={Landmark} title="Bank details" action={edit("bank")}>
          <Grid>
            <Item label="Name in bank" value={e.bank?.nameInBank ?? "—"} />
            <Item label="Bank name" value={e.bank?.bankName ?? "—"} />
            <Item label="Account number" value={e.bank?.bankAccountNumber ?? "—"} />
            <Item label="IBAN / IFSC" value={e.bank?.ibanIfsc ?? "—"} />
          </Grid>
        </Section>

        {/* Education */}
        <Section icon={GraduationCap} title="Education" action={edit("education")}>
          {e.education?.length ? (
            <div className="space-y-3">
              {e.education.map((ed, i) => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <p className="font-medium">{ed.qualification || "—"}</p>
                  <p className="text-sm text-muted-foreground">{ed.institute || "—"}{ed.from || ed.to ? ` · ${ed.from ?? "?"}–${ed.to ?? "?"}` : ""}</p>
                </div>
              ))}
            </div>
          ) : <Empty />}
        </Section>

        {/* Current address */}
        <Section icon={MapPin} title="Current address" action={edit("currentAddress")}>
          <AddressBlock a={e.currentAddress} />
        </Section>

        {/* Permanent address */}
        <Section icon={Home} title="Permanent / home address" action={edit("permanentAddress")}>
          <AddressBlock a={e.permanentAddress} />
        </Section>

        {/* Emergency */}
        <Section icon={ShieldAlert} title="Emergency contacts" action={edit("emergency")} className="lg:col-span-2">
          {e.emergencyContacts?.length ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {e.emergencyContacts.map((c, i) => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{c.name || "—"}</p>
                    {c.relation && <Badge variant="secondary">{c.relation}</Badge>}
                  </div>
                  <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                    {c.phoneNumber && <p className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{c.phoneNumber}</p>}
                    {c.email && <p className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{c.email}</p>}
                    {(c.address || c.city || c.state || c.country) && <p className="flex items-start gap-1.5"><MapPin className="mt-0.5 h-3.5 w-3.5" />{[c.address, c.city, c.state, c.country].filter(Boolean).join(", ")}</p>}
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty />}
        </Section>
      </motion.div>

      {section && <EmployeeSectionDialog open={!!section} onOpenChange={(o) => !o && setSection(null)} section={section} employee={e} />}
      <ConfirmDialog
        open={deleteOpen} onOpenChange={setDeleteOpen}
        title="Delete employee" description={`${e.name} (${e.employeeCode}) will be permanently removed.`}
        isPending={deleting}
        onConfirm={() => remove(e._id, { onSuccess: () => router.push("/employees") })}
      />
    </div>
  );
}

function Section({ icon: Icon, title, action, children, className }: {
  icon: React.ElementType; title: string; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <motion.div variants={item} className={className}>
      <Card className="h-full p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2"><Icon className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">{title}</h3></div>
          {action}
        </div>
        {children}
      </Card>
    </motion.div>
  );
}

const Grid = ({ children }: { children: React.ReactNode }) => <div className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</div>;

function Item({ label, value, icon: Icon, full, accent }: {
  label: string; value: string; icon?: React.ElementType; full?: boolean; accent?: boolean;
}) {
  return (
    <div className={cn("min-w-0", full && "col-span-2")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 flex items-center gap-1.5 truncate text-sm font-medium", accent && "text-primary")} title={value}>
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}{value}
      </p>
    </div>
  );
}

function AddressBlock({ a }: { a?: { address?: string; city?: string; state?: string; country?: string } }) {
  if (!a || !(a.address || a.city || a.state || a.country)) return <Empty />;
  return (
    <div className="space-y-1 text-sm">
      {a.address && <p className="font-medium">{a.address}</p>}
      <p className="text-muted-foreground">{[a.city, a.state, a.country].filter(Boolean).join(", ") || "—"}</p>
    </div>
  );
}

const Empty = () => <p className="py-4 text-center text-sm text-muted-foreground">Not added yet.</p>;
