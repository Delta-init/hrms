"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Loader2, FileText, Mail, Phone, Building2, Clock, Video, MapPin, Link2,
} from "lucide-react";
import { useCandidate } from "@/hooks/useCandidates";
import { PageHeader } from "@/components/shared/PageHeader";
import { getInitials, cn } from "@/lib/utils";
import {
  STAGE_LABELS, INTERVIEW_MODE_LABELS, INTERVIEW_STATUS_LABELS,
  type Application, type Interview,
} from "@/types";

const fmtDate = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "—";
const fmtWhen = (iso: string, tz?: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: tz || undefined,
  }).format(new Date(iso));

const titleOf = (v: Application["requisition"]) => (v && typeof v === "object" ? v.title : "—");
const idOf = (v: Application["requisition"]) => (v && typeof v === "object" ? v._id : String(v ?? ""));

const statusTone: Record<string, string> = {
  scheduled: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  no_show: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  cancelled: "bg-muted text-muted-foreground border-border",
};

/**
 * One candidate, and everything that has happened to them.
 *
 * The point of storing a person once is that this page exists: every role they
 * were put forward for, how far they got, and every conversation anybody has
 * had with them — including the ones that ended in a no.
 */
export default function CandidateDetailPage() {
  const { id } = useParams();
  const { data: c, isLoading } = useCandidate(String(id));

  if (isLoading) {
    return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!c) {
    return <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">Candidate not found.</p>;
  }

  const applications = c.applications ?? [];
  const allInterviews = applications.flatMap((a) => a.interviews ?? []);

  const facts: Array<[React.ElementType, string, string | undefined]> = [
    [Mail, "Email", c.email],
    [Phone, "Phone", c.phone],
    [Building2, "Currently", [c.currentDesignation, c.currentCompany].filter(Boolean).join(" at ") || undefined],
    [Clock, "Notice", c.noticePeriodDays != null ? `${c.noticePeriodDays} days` : undefined],
  ];

  return (
    <div className="space-y-6">
      <Link href="/hiring/candidates" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />Candidates
      </Link>

      <div className="flex flex-wrap items-start gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
          {getInitials(c.name)}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">{c.name}</h1>
          <p className="text-sm text-muted-foreground">
            {c.source ? `via ${c.source} · ` : ""}added {fmtDate(c.createdAt)}
          </p>
          <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {facts.filter(([, , v]) => v).map(([Icon, label, value]) => (
              <div key={label} className="flex items-center gap-2 text-muted-foreground">
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate"><span className="text-foreground">{value}</span></span>
              </div>
            ))}
            {c.expectedSalary != null && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="text-xs">Expecting</span>
                <span className="tabular-nums text-foreground">{c.currency} {c.expectedSalary}</span>
              </div>
            )}
          </div>
        </div>
        {c.resumeUrl && (
          <a href={c.resumeUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-primary hover:bg-muted">
            <FileText className="h-4 w-4" />{c.resumeFileName || "CV"}
          </a>
        )}
      </div>

      {c.notes && (
        <div className="rounded-2xl border border-border bg-card p-4 text-sm shadow-sm">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>
          <p className="whitespace-pre-wrap text-muted-foreground">{c.notes}</p>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Applications ({applications.length})
        </h2>
        {applications.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            Not yet put forward for anything.
          </p>
        ) : (
          <div className="space-y-3">
            {applications.map((a) => (
              <div key={a._id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/hiring/${idOf(a.requisition)}`} className="font-medium hover:underline">
                    {titleOf(a.requisition)}
                  </Link>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="rounded-full border border-border px-2 py-0.5">{STAGE_LABELS[a.stage]}</span>
                    {a.status !== "active" && (
                      <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-red-600">
                        {a.status === "rejected" ? "Rejected" : "Withdrew"}
                      </span>
                    )}
                  </div>
                </div>
                {a.rejectionReason && (
                  <p className="mt-1 text-xs text-muted-foreground">Reason: {a.rejectionReason}</p>
                )}
                <InterviewList interviews={a.interviews ?? []} />
              </div>
            ))}
          </div>
        )}
      </div>

      {allInterviews.length === 0 && applications.length > 0 && (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Nobody has interviewed them yet.
        </p>
      )}
    </div>
  );
}

/** The conversations, or a plain statement that there have not been any. */
function InterviewList({ interviews }: { interviews: Interview[] }) {
  if (!interviews.length) {
    return <p className="mt-2 text-xs text-muted-foreground">No interview scheduled.</p>;
  }
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      {interviews.map((iv) => {
        const panel = Array.isArray(iv.panel) ? iv.panel : [];
        const names = panel.map((p) => (typeof p === "object" ? p.name : "")).filter(Boolean).join(", ");
        return (
          <div key={iv._id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-medium text-foreground">Round {iv.round}</span>
            <span className={cn("rounded-full border px-2 py-0.5", statusTone[iv.status])}>
              {INTERVIEW_STATUS_LABELS[iv.status]}
            </span>
            <span className="text-muted-foreground">{fmtWhen(iv.scheduledAt, iv.timeZone)}</span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              {iv.mode === "video" ? <Video className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
              {INTERVIEW_MODE_LABELS[iv.mode]}
            </span>
            {names && <span className="text-muted-foreground">with {names}</span>}
            {iv.recordingLink && (
              <a href={iv.recordingLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                <Link2 className="h-3 w-3" />Recording
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
