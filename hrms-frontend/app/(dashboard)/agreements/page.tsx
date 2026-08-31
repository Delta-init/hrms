"use client";
import { useState } from "react";
import Link from "next/link";
import {
  FileSignature, FileText, Loader2, Check, X, ExternalLink, AlertTriangle, Clock,
} from "lucide-react";
import { useSignedAgreements, useReviewAgreement } from "@/hooks/useAgreements";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { getInitials, cn } from "@/lib/utils";
import { AGREEMENT_KIND_LABELS, type SignedAgreementRow } from "@/types";

/**
 * What people have signed, and whether HR has accepted it.
 *
 * The approvals console could already decide these, but it links here — and
 * until now there was nothing here, so a signing could be approved without
 * anybody having read what was signed. The documents are the point of the page.
 */

const statusStyles: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  rejected: "bg-red-500/10 text-red-600 border-red-500/20",
};

const fmt = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";

const person = (r: SignedAgreementRow) =>
  r.employee && typeof r.employee === "object" ? r.employee : null;

export default function AgreementsPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("employees", "view");
  const canReview = hasPermission("employees", "approve");

  const [tab, setTab] = useState("pending");
  const status = tab === "all" ? undefined : tab;
  const { data: rows = [], isLoading } = useSignedAgreements(status, canView);
  const { data: pending = [] } = useSignedAgreements("pending", canView);
  const [open, setOpen] = useState<SignedAgreementRow | null>(null);

  if (!canView) {
    return (
      <div className="space-y-6">
        <PageHeader title="Signed agreements" description="NDAs and terms signed at onboarding." icon={FileSignature} />
        <Card className="p-16 text-center text-muted-foreground">You don&apos;t have access to signed agreements.</Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Signed agreements"
        description="What people signed at onboarding, and the documents they signed."
        icon={FileSignature}
      />

      <Tabs
        tabs={[
          { key: "pending", label: "Awaiting review", icon: Clock, count: pending.length },
          { key: "approved", label: "Approved", icon: Check },
          { key: "rejected", label: "Sent back", icon: X },
          { key: "all", label: "Everyone", icon: FileText },
        ]}
        value={tab}
        onChange={setTab}
      />

      {isLoading ? (
        <Card className="flex justify-center p-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>
      ) : !rows.length ? (
        <Card className="p-16 text-center text-muted-foreground">
          <FileSignature className="mx-auto mb-2 h-7 w-7" />
          {tab === "pending" ? "Nothing waiting to be reviewed." : "Nothing here yet."}
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => {
            const who = person(r);
            const view = r.videoView;
            return (
              <Card key={r._id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {getInitials(who?.name ?? r.typedName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {who ? (
                        <Link href={`/employees/${who._id}`} className="truncate font-medium hover:underline">{who.name}</Link>
                      ) : (
                        <span className="truncate font-medium">{r.typedName}</span>
                      )}
                      <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize", statusStyles[r.status])}>
                        {r.status === "rejected" ? "sent back" : r.status}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {who?.employeeCode ? `${who.employeeCode} · ` : ""}{r.variant === "remote" ? "Remote" : "Onsite"} · signed {fmt(r.signedAt)}
                    </p>

                    {/* The number that says "look closer" — a signature is only
                        as good as the induction it claims to have watched. */}
                    {!!view?.skipAttempts && (
                      <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-600">
                        <AlertTriangle className="h-3 w-3" />
                        {view.skipAttempts} skip attempt{view.skipAttempts === 1 ? "" : "s"} during the induction
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {r.documents.map((d) => (
                        <a
                          key={`${d.kind}-${d.version}`} href={d.url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          {AGREEMENT_KIND_LABELS[d.kind] ?? d.kind}
                          <span className="text-muted-foreground">v{d.version}</span>
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </a>
                      ))}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => setOpen(r)}>Open</Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ReviewDialog record={open} onOpenChange={(o) => !o && setOpen(null)} canReview={canReview} />
    </div>
  );
}

function ReviewDialog({ record, onOpenChange, canReview }: {
  record: SignedAgreementRow | null; onOpenChange: (o: boolean) => void; canReview: boolean;
}) {
  const { mutate: review, isPending } = useReviewAgreement();
  const [note, setNote] = useState("");
  const who = record ? person(record) : null;
  const view = record?.videoView;

  return (
    <ResponsiveDialog open={!!record} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{who?.name ?? record?.typedName ?? "Signing"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        {record && (
          <div className="space-y-4 px-4 sm:px-0">
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ["Signed as", record.typedName],
                ["Variant", record.variant === "remote" ? "Remote" : "Onsite"],
                ["Signed at", fmt(record.signedAt)],
                ["From IP", record.signedIp || "unrecorded"],
                ["Induction watched", view ? `${Math.round(view.watchedSeconds ?? 0)}s` : "—"],
                ["Skip attempts", String(view?.skipAttempts ?? 0)],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="font-medium">{value}</p>
                </div>
              ))}
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Signature</Label>
              {/* Shown on white whatever the theme: a signature is ink on paper,
                  and a dark card turns a black stroke invisible. */}
              <div className="mt-1 rounded-lg border border-border bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={record.signatureUrl} alt="Signature" className="mx-auto h-20 object-contain" />
              </div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Documents as signed</Label>
              <div className="mt-1 space-y-1.5">
                {record.documents.map((d) => (
                  <a
                    key={`${d.kind}-${d.version}`} href={d.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-border p-2.5 text-sm hover:bg-muted"
                  >
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1">{AGREEMENT_KIND_LABELS[d.kind] ?? d.kind} · v{d.version}</span>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </a>
                ))}
              </div>
            </div>

            {record.reviewNote && (
              <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">{record.reviewNote}</p>
            )}

            {canReview && record.status === "pending" && (
              <div className="space-y-2">
                <Label htmlFor="note">Note (required to send back)</Label>
                <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                          placeholder="What needs correcting?" />
              </div>
            )}
          </div>
        )}

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {canReview && record?.status === "pending" && (
            <>
              <Button
                variant="outline" className="text-red-600" disabled={isPending || !note.trim()}
                onClick={() => review({ id: record._id, action: "reject", note }, { onSuccess: () => { setNote(""); onOpenChange(false); } })}
              >
                <X className="h-4 w-4" />Send back
              </Button>
              <Button
                disabled={isPending}
                onClick={() => review({ id: record._id, action: "approve", note: note || undefined }, { onSuccess: () => { setNote(""); onOpenChange(false); } })}
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Approve
              </Button>
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
