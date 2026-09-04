"use client";
import Link from "next/link";
import { FileSignature, FileText, ExternalLink, Download, Loader2, Clock, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMyAgreements } from "@/hooks/useAgreements";
import { cn } from "@/lib/utils";
import { AGREEMENT_KIND_LABELS } from "@/types";

const STATUS: Record<"pending" | "approved" | "rejected", { label: string; tone: string; icon: typeof Clock }> = {
  pending: { label: "Waiting on HR to verify", tone: "bg-amber-500/10 text-amber-600", icon: Clock },
  approved: { label: "Signed and verified", tone: "bg-emerald-500/10 text-emerald-600", icon: CheckCircle2 },
  rejected: { label: "Sent back — needs signing again", tone: "bg-red-500/10 text-red-600", icon: AlertTriangle },
};

/**
 * The NDA and company terms this person signed during onboarding, read-only.
 *
 * The signing flow itself lives at /onboarding/agreements — this is only the
 * other side of it, the copy of what you already signed, reachable after
 * onboarding is long finished rather than only during it. Renders nothing
 * where the organisation doesn't require signing at all, or where nothing
 * has been signed yet — a blank profile section would just be noise.
 */
export function MyAgreementsCard() {
  const { data, isLoading } = useMyAgreements();

  if (isLoading) {
    return (
      <Card className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }
  if (!data?.required || !data.agreement) return null;

  const { status, documents, reviewNote } = data.agreement;
  const s = STATUS[status];

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FileSignature className="h-4 w-4 text-muted-foreground" />
          Signed agreements
        </h2>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", s.tone)}>
          <s.icon className="h-3.5 w-3.5" />{s.label}
        </span>
      </div>

      {status === "rejected" && (
        <div className="mb-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm">
          {reviewNote && <p className="mb-2 text-muted-foreground">{reviewNote}</p>}
          <Button asChild size="sm" variant="outline">
            <Link href="/onboarding/agreements">Sign again</Link>
          </Button>
        </div>
      )}

      <div className="space-y-1.5">
        {documents.map((d) => (
          <div key={`${d.kind}-${d.version}`} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <span className="flex-1 text-sm">{AGREEMENT_KIND_LABELS[d.kind]}</span>
            <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              View <ExternalLink className="h-3 w-3" />
            </a>
            <a href={`${d.url}&download=1`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              Download <Download className="h-3 w-3" />
            </a>
          </div>
        ))}
      </div>
    </Card>
  );
}
