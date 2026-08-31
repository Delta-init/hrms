"use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Landmark, ArrowLeft, Pencil, Loader2, Mail, ShieldCheck, ScanFace, Building2,
  MonitorSmartphone, Clock, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { useOrganization } from "@/hooks/useOrganizations";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { OrganizationDialog } from "@/components/organizations/OrganizationDialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { REMOTE_DEVICE_LABELS } from "@/types";

/**
 * One organization, on its own page.
 *
 * The settings that decide how a whole company behaves — whether new joiners
 * are held at the agreements, whether office staff must punch at a kiosk, where
 * its email comes from — were reachable only through a dropdown on a row in a
 * table. This is the page they belong on, and the one a link can point at.
 */

const statusStyles: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  inactive: "bg-muted text-muted-foreground border-border",
  suspended: "bg-red-500/10 text-red-600 border-red-500/20",
};

/** A setting, shown as what it does rather than what it is called. */
function Setting({ icon: Icon, label, on, detail, warn }: {
  icon: React.ElementType; label: string; on: boolean; detail: string; warn?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border p-3.5">
      <div className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
        on ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"
      )}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{label}</p>
          <span className={cn(
            "rounded-full border px-2 py-0.5 text-[11px] font-medium",
            on ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600" : "border-border bg-muted text-muted-foreground"
          )}>
            {on ? "On" : "Off"}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
        {on && warn && (
          <p className="mt-1.5 inline-flex items-start gap-1 text-[11px] text-amber-600">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />{warn}
          </p>
        )}
      </div>
    </div>
  );
}

export default function OrganizationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPermission } = useAuth();
  const canView = hasPermission("organizations", "view");
  const canEdit = hasPermission("organizations", "edit");
  const { data: org, isLoading } = useOrganization(canView ? id : undefined);
  const [editing, setEditing] = useState(false);

  if (!canView) {
    return (
      <div className="space-y-6">
        <PageHeader title="Organization" icon={Landmark} />
        <Card className="p-16 text-center text-muted-foreground">You don&apos;t have access to organizations.</Card>
      </div>
    );
  }
  if (isLoading) return <Card className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>;
  if (!org) {
    return (
      <div className="space-y-6">
        <PageHeader title="Organization" icon={Landmark} />
        <Card className="p-16 text-center text-muted-foreground">That organization could not be found.</Card>
      </div>
    );
  }

  const s = org.settings ?? {};
  const smtpReady = !!(s.smtpHost && s.smtpUser);

  return (
    <div className="space-y-6">
      <Link href="/organizations" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />Organizations
      </Link>

      <Card className="flex flex-wrap items-start justify-between gap-4 p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight">{org.name}</h1>
              <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize", statusStyles[org.status] ?? statusStyles.inactive)}>
                {org.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {org.code} · {s.currency || "—"} · {s.timeZone || "—"}
            </p>
          </div>
        </div>
        {canEdit && (
          <Button onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Edit settings</Button>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold">Onboarding</h2>
          <div className="space-y-2.5">
            <Setting
              icon={ShieldCheck} label="Hold new joiners at the agreements"
              on={!!s.requireAgreements}
              detail="Nobody reaches the app until they have watched the induction and signed."
              warn="Everyone who has not signed is held on their next page load, not only new joiners."
            />
            <Setting
              icon={ScanFace} label="Also require face check-in"
              on={!!s.requireFaceEnrollment}
              detail="Adds a face on file as the last step of onboarding."
              warn="Ignored while the face matching service is unreachable, so an outage holds nobody."
            />
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold">Attendance</h2>
          <div className="space-y-2.5">
            <Setting
              icon={MonitorSmartphone} label="Office staff punch at a kiosk"
              on={!!s.enforceWorkMode}
              detail="Office staff cannot clock in from their own dashboard."
            />
            <div className="flex items-start gap-3 rounded-xl border border-border p-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium">Remote device policy</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {REMOTE_DEVICE_LABELS[s.remoteDevice ?? "off"] ?? "Off"} — how closely remote staff are held to one browser.
                </p>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Email</h2>
          {/* The one setting whose absence is silent: without it every
              notification the system sends is written to a log and dropped. */}
          <div className={cn(
            "flex items-start gap-3 rounded-xl border p-3.5",
            smtpReady ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"
          )}>
            {smtpReady
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {smtpReady ? "Email is configured" : "No email server configured"}
              </p>
              {smtpReady ? (
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                  {[
                    ["From", s.mailFrom || "—"],
                    ["Host", `${s.smtpHost}${s.smtpPort ? `:${s.smtpPort}` : ""}`],
                    ["User", s.smtpUser || "—"],
                    ["Password", s.smtpPass ? "•••••••• stored" : "not set"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <dt className="w-20 shrink-0 text-muted-foreground">{k}</dt>
                      <dd className="truncate font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Every notification — account invites, approval digests, birthday notes, the morning
                  late notice — is written to the server log and never sent. Nothing fails and nobody
                  is told, which is what makes this worth saying here.
                </p>
              )}
              {canEdit && (
                <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => setEditing(true)}>
                  <Mail className="h-3.5 w-3.5" />{smtpReady ? "Change it" : "Set it up"}
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      <OrganizationDialog
        open={editing}
        onOpenChange={(o) => { setEditing(o); if (!o) router.refresh(); }}
        organization={org}
      />
    </div>
  );
}
