"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  User2, Briefcase, Landmark, GraduationCap, MapPin, Home, ShieldAlert,
  Mail, Phone, CalendarDays, Clock3, Users2, BookUser, Plane,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmployeeSectionDialog, type ProfileSection } from "@/components/employees/EmployeeSectionDialog";
import { cn } from "@/lib/utils";
import { GENDER_LABELS, MARITAL_LABELS, type Employee, type EmployeeRef } from "@/types";

const fmtDate = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—");
const nameOf = (r?: EmployeeRef | { _id: string; name: string } | string | null) => (r && typeof r === "object" ? r.name : null);
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

/**
 * The grouped, editable profile sections for an employee (reused across pages).
 * variant: "all" → everything · "core" → all except passport/visa ·
 * "documents" → only passport + visa.
 */
export function EmployeeProfileSections({ employee: e, canEdit, variant = "all" }: {
  employee: Employee; canEdit: boolean; variant?: "all" | "core" | "documents";
}) {
  const [section, setSection] = useState<ProfileSection | null>(null);
  const edit = (s: ProfileSection) => (
    canEdit ? <EditButton onClick={() => setSection(s)} /> : null
  );
  const showProfile = variant !== "documents";
  const showDocs = variant !== "core";

  return (
    <>
      <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {showProfile && <>
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

        <Section icon={Briefcase} title="Employment details" action={edit("employment")}>
          <Grid>
            <Item label="Department" value={deptName(e) ?? "—"} />
            <Item label="Location" value={e.location ?? "—"} icon={MapPin} />
            <Item label="Reporting to" value={nameOf(e.reportingTo) ?? "—"} />
            <Item label="Currency" value={e.currency ?? "—"} />
            <Item label="Joining date" value={fmtDate(e.joiningDate)} icon={CalendarDays} />
            <Item label="Confirmation date" value={fmtDate(e.confirmationDate)} icon={CalendarDays} />
            <Item label="Probation" value={e.probationPeriodDays ? `${e.probationPeriodDays} days` : "—"} />
            <Item label="Notice period" value={e.noticePeriodDays != null ? `${e.noticePeriodDays} days` : "—"} />
            <Item label="Current experience" value={experience(e.joiningDate)} icon={Clock3} accent />
            <Item label="Previous experience" value={e.oldCompanyExperience ?? "—"} full />
          </Grid>
        </Section>

        <Section icon={Landmark} title="Bank details" action={edit("bank")}>
          <Grid>
            <Item label="Name in bank" value={e.bank?.nameInBank ?? "—"} />
            <Item label="Bank name" value={e.bank?.bankName ?? "—"} />
            <Item label="Account number" value={e.bank?.bankAccountNumber ?? "—"} />
            <Item label="IBAN / IFSC" value={e.bank?.ibanIfsc ?? "—"} />
          </Grid>
        </Section>

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

        <Section icon={MapPin} title="Current address" action={edit("currentAddress")}>
          <AddressBlock a={e.currentAddress} />
        </Section>

        <Section icon={Home} title="Permanent / home address" action={edit("permanentAddress")}>
          <AddressBlock a={e.permanentAddress} />
        </Section>

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

        {/* Family */}
        <Section icon={Users2} title="Family members" action={edit("family")} className="lg:col-span-2">
          {e.familyMembers?.length ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {e.familyMembers.map((m, i) => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{m.name || "—"}</p>
                    {m.relation && <Badge variant="secondary">{m.relation}</Badge>}
                  </div>
                  <div className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                    {m.dob && <p className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />{fmtDate(m.dob)}</p>}
                    {m.phone && <p className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{m.phone}</p>}
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty />}
        </Section>

        </>}

        {showDocs && <>
        {/* Passport */}
        <Section icon={BookUser} title="Passport details" action={edit("passport")}>
          <Grid>
            <Item label="Passport number" value={e.passport?.passportNumber ?? "—"} />
            <Item label="Country" value={e.passport?.country ?? "—"} />
            <Item label="Issue date" value={fmtDate(e.passport?.issueDate)} icon={CalendarDays} />
            <Item label="Expiry date" value={fmtDate(e.passport?.expiryDate)} icon={CalendarDays} />
          </Grid>
        </Section>

        {/* Visa */}
        <Section icon={Plane} title="Visa details" action={edit("visa")}>
          <Grid>
            <Item label="Country" value={e.visa?.country ?? "—"} icon={MapPin} />
            <Item label="Type" value={e.visa?.type ?? "—"} />
            <Item label="Issue date" value={fmtDate(e.visa?.issueDate)} icon={CalendarDays} />
            <Item label="Expiry date" value={fmtDate(e.visa?.expiryDate)} icon={CalendarDays} />
          </Grid>
        </Section>
        </>}
      </motion.div>

      {section && <EmployeeSectionDialog open={!!section} onOpenChange={(o) => !o && setSection(null)} section={section} employee={e} />}
    </>
  );
}

function EditButton({ onClick }: { onClick: () => void }) {
  // Lightweight local button to avoid a hard dep on the shared Button here.
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted">
      <PencilIcon />Edit
    </button>
  );
}
function PencilIcon() {
  return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
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
