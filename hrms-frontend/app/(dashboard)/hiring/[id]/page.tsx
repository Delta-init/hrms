"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Plus, FileText, Loader2, XCircle, ChevronRight, Users, AlertTriangle,
  CalendarPlus, CalendarCheck, Video, MapPin, UserPlus, Phone, Link2, ExternalLink,
  Pencil, Check, X, KanbanSquare,
} from "lucide-react";
import { useRequisitions } from "@/hooks/useHiring";
import { usePipeline, useCandidates, useApplyCandidate, useMoveApplication } from "@/hooks/useCandidates";
import { useInterviews, useUpdateInterview } from "@/hooks/useInterviews";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { CandidateDialog } from "@/components/hiring/CandidateDialog";
import { ScheduleInterviewDialog } from "@/components/hiring/ScheduleInterviewDialog";
import { HireDialog } from "@/components/hiring/HireDialog";
import { PipelineBoard } from "@/components/hiring/PipelineBoard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { getInitials, cn } from "@/lib/utils";
import {
  APPLICATION_STAGES, STAGE_LABELS, REQUISITION_STATUS_LABELS, REQUISITION_TYPE_LABELS,
  INTERVIEW_STATUS_LABELS, INTERVIEW_MODE_LABELS,
  type Application, type Candidate, type Interview, type InterviewMode, type InterviewStatus,
} from "@/types";

const nameOf = (v: unknown) => (v && typeof v === "object" ? (v as { name?: string }).name ?? "—" : "—");
const asCandidate = (v: Application["candidate"]): Candidate | null => (v && typeof v === "object" ? v : null);

const MODE_ICON: Record<InterviewMode, React.ElementType> = { video: Video, in_person: MapPin, phone: Phone };
const STATUS_TONE: Record<InterviewStatus, string> = {
  scheduled: "border-sky-500/20 bg-sky-500/10 text-sky-600",
  completed: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600",
  no_show: "border-amber-500/20 bg-amber-500/10 text-amber-600",
  cancelled: "border-border bg-muted text-muted-foreground",
};
const fmtWhen = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/**
 * One requisition and the people in its pipeline.
 *
 * The board moves by picking the next stage rather than dragging: it needs no
 * new dependency, works on a phone, and is reachable from a keyboard — and
 * recruiters skip stages constantly, which a drag between adjacent columns
 * makes awkward anyway.
 */
export default function RequisitionDetailPage() {
  const { id } = useParams();
  const requisitionId = String(id);
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("hiring", "edit");
  const canCreate = hasPermission("hiring", "create");

  // The list endpoint is already cached by the hiring page, so this usually
  // resolves without a second round trip.
  const { data: reqData, isLoading: reqLoading } = useRequisitions({ limit: "100" });
  const requisition = (reqData?.data ?? []).find((r) => r._id === requisitionId);

  const { data: pipeline, isLoading } = usePipeline(requisitionId);
  const { mutate: move, isPending: moving } = useMoveApplication();

  const [tab, setTab] = useState<"pipeline" | "meetings">("pipeline");
  const [addOpen, setAddOpen] = useState(false);
  const [scheduling, setScheduling] = useState<Application | null>(null);
  const [hiring, setHiring] = useState<Application | null>(null);
  const [closing, setClosing] = useState<{ app: Application; kind: "rejected" | "waitlisted" } | null>(null);
  const [reason, setReason] = useState("");

  const approved = requisition?.status === "approved";

  return (
    <div className="space-y-6">
      <Link href="/hiring" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />Hiring
      </Link>

      <PageHeader
        title={requisition?.title ?? (reqLoading ? "Loading…" : "Requisition")}
        description={
          requisition
            ? `${REQUISITION_TYPE_LABELS[requisition.type]} · ${nameOf(requisition.department)} · ${requisition.headcount} position${requisition.headcount === 1 ? "" : "s"}`
            : ""
        }
        icon={Users}
        action={
          canCreate && approved && (
            <Button onClick={() => setAddOpen(true)} className="shadow-sm"><Plus className="h-4 w-4" />Add candidate</Button>
          )
        }
      />

      {/* Recruiting against an unapproved requisition is the thing the whole
          chain exists to prevent, so the reason is stated rather than the
          button just being absent. */}
      {requisition && !approved && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This requisition is <strong>{REQUISITION_STATUS_LABELS[requisition.status].toLowerCase()}</strong>.
            Candidates can only be added once it is approved.
          </span>
        </div>
      )}

      {requisition && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl border border-border bg-card p-4 text-sm shadow-sm sm:grid-cols-4">
          {([
            ["Status", REQUISITION_STATUS_LABELS[requisition.status]],
            ["Type", REQUISITION_TYPE_LABELS[requisition.type]],
            ["Replacing", requisition.type === "replacement" ? nameOf(requisition.replacing) : "—"],
            ["Headcount", String(requisition.headcount)],
            ["Budget", requisition.salaryMax ? `${requisition.currency ?? ""} ${requisition.salaryMin ? `${requisition.salaryMin}–` : "up to "}${requisition.salaryMax}`.trim() : "—"],
            ["Accounts", requisition.budgetApprovalRequired ? "Required" : "Not required"],
            ["Raised by", nameOf(requisition.raisedBy)],
            ["Wanted by", requisition.targetStartDate ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(requisition.targetStartDate)) : "—"],
          ] as Array<[string, string]>).map(([k, v]) => (
            <div key={k}>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</p>
              <p className="truncate font-medium">{v}</p>
            </div>
          ))}
          {!!requisition.approvalTrail?.length && (
            <div className="col-span-2 sm:col-span-4 border-t border-border pt-3">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Approval trail</p>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {requisition.approvalTrail.map((t, i) => (
                  <span key={i} className="flex items-center gap-2">
                    {i > 0 && <span className="opacity-40">→</span>}
                    <span className={cn("rounded-full border px-2 py-0.5", t.action === "approved" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600" : "border-red-500/20 bg-red-500/10 text-red-600")}>
                      {t.roleName ?? `Step ${t.step}`} {t.action}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {(requisition.jdUrl || requisition.jdText) && (
            <div className="col-span-2 sm:col-span-4 border-t border-border pt-3">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Job description</p>
              {requisition.jdUrl && (
                <a href={requisition.jdUrl} target="_blank" rel="noopener noreferrer"
                  className="mb-2 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-primary hover:bg-muted">
                  <FileText className="h-3.5 w-3.5" />{requisition.jdFileName || "Attached JD"}
                </a>
              )}
              {requisition.jdText && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{requisition.jdText}</p>}
            </div>
          )}
        </div>
      )}

      <Tabs
        tabs={[
          { key: "pipeline", label: "Pipeline", icon: KanbanSquare },
          { key: "meetings", label: "Meetings", icon: CalendarCheck },
        ]}
        value={tab}
        onChange={(k) => setTab(k as "pipeline" | "meetings")}
      />

      {tab === "pipeline" ? (
        isLoading ? (
          <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <PipelineBoard
            columns={pipeline?.columns ?? []}
            closed={pipeline?.closed ?? []}
            canEdit={canEdit}
            busy={moving}
            onMove={(id, stage) => move({ id, stage })}
            onReject={(app) => { setClosing({ app, kind: "rejected" }); setReason(""); }}
            onWaitlist={(app) => { setClosing({ app, kind: "waitlisted" }); setReason(""); }}
            onRestore={(id) => move({ id, status: "active" })}
            onSchedule={setScheduling}
            onHire={setHiring}
          />
        )
      ) : (
        <MeetingsTab requisitionId={requisitionId} canEdit={canEdit} />
      )}

      <AddToPipeline open={addOpen} onOpenChange={setAddOpen} requisitionId={requisitionId} />

      {hiring && (
        <HireDialog
          open={!!hiring}
          onOpenChange={(o) => !o && setHiring(null)}
          applicationId={hiring._id}
          candidateName={asCandidate(hiring.candidate)?.name}
        />
      )}

      {scheduling && (
        <ScheduleInterviewDialog
          open={!!scheduling}
          onOpenChange={(o) => !o && setScheduling(null)}
          applicationId={scheduling._id}
          candidateName={asCandidate(scheduling.candidate)?.name}
          nextRound={(scheduling.interviews ?? []).filter((i) => i.status !== "cancelled").length + 1}
        />
      )}

      <ResponsiveDialog open={!!closing} onOpenChange={(o) => !o && setClosing(null)}>
        <ResponsiveDialogContent desktopClassName="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {closing?.kind === "waitlisted" ? "Move to the waiting list?" : "Reject this candidate?"}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-3 px-4 sm:px-0">
            <div className="space-y-1.5">
              <Label htmlFor="reason">Why? *</Label>
              <Textarea id="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder={closing?.kind === "waitlisted" ? "Strong, but no vacancy right now…" : "Salary expectations, notice period, experience…"} />
              <p className="text-[11px] text-muted-foreground">
                {closing?.kind === "waitlisted"
                  ? "They stay on the waiting list and can be brought back at any time."
                  : "Recorded against the candidate, and shown if they apply again. They can still be brought back."}
              </p>
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setClosing(null)}>Cancel</Button>
            <Button variant={closing?.kind === "waitlisted" ? "default" : "destructive"} disabled={!reason.trim() || moving}
              onClick={() => closing && move(
                { id: closing.app._id, status: closing.kind, reason: reason.trim() },
                { onSuccess: () => setClosing(null) }
              )}>
              {closing?.kind === "waitlisted" ? "Waiting list" : "Reject"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  );
}

/** Pick somebody already on file, or add a new person and use them at once. */
function AddToPipeline({ open, onOpenChange, requisitionId }: { open: boolean; onOpenChange: (o: boolean) => void; requisitionId: string }) {
  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const { data } = useCandidates(search ? { search, limit: "10" } : { limit: "10" });
  const { mutate: apply, isPending } = useApplyCandidate();

  const add = (candidate: string) => apply({ requisition: requisitionId, candidate }, { onSuccess: () => onOpenChange(false) });

  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent desktopClassName="max-w-lg">
          <ResponsiveDialogHeader><ResponsiveDialogTitle>Add to this pipeline</ResponsiveDialogTitle></ResponsiveDialogHeader>
          <div className="space-y-3 px-4 sm:px-0">
            <Input placeholder="Search candidates by name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {(data?.data ?? []).map((c) => (
                <button key={c._id} type="button" disabled={isPending} onClick={() => add(c._id)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border p-2 text-left transition hover:bg-muted disabled:opacity-50">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {getInitials(c.name)}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{c.currentCompany || c.email}</div>
                  </div>
                </button>
              ))}
              {!(data?.data ?? []).length && <p className="py-6 text-center text-sm text-muted-foreground">Nobody matches.</p>}
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" />New candidate</Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <CandidateDialog open={newOpen} onOpenChange={setNewOpen} onSaved={(candidateId) => { setNewOpen(false); add(candidateId); }} />
    </>
  );
}

/**
 * Every interview booked against this role, across all its candidates.
 *
 * A recording is a link, not a file: `recordingLink` is the pointer to
 * wherever the meeting tool put it, and the ordinary interview-update
 * endpoint already accepts it — nothing new to save it, only somewhere to
 * see and edit it. Anyone holding `hiring.edit` can set one; Super Admin
 * always can, since it bypasses permissions entirely.
 */
function MeetingsTab({ requisitionId, canEdit }: { requisitionId: string; canEdit: boolean }) {
  const { data, isLoading } = useInterviews({ requisition: requisitionId, limit: "100" });
  const interviews = data?.data ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const { mutate: update, isPending: saving } = useUpdateInterview();

  const startEdit = (iv: Interview) => { setEditing(iv._id); setLink(iv.recordingLink ?? ""); };
  const save = (id: string) =>
    update({ id, recordingLink: link.trim() }, { onSuccess: () => setEditing(null) });

  if (isLoading) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!interviews.length) {
    return <Card className="p-16 text-center text-muted-foreground">No interviews scheduled for this role yet.</Card>;
  }

  return (
    <div className="space-y-3">
      {interviews.map((iv) => {
        const app = typeof iv.application === "object" ? iv.application : null;
        const candidate = app?.candidate && typeof app.candidate === "object" ? app.candidate : null;
        const ModeIcon = MODE_ICON[iv.mode];
        const isEditing = editing === iv._id;

        return (
          <Card key={iv._id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", STATUS_TONE[iv.status])}>
                    {INTERVIEW_STATUS_LABELS[iv.status]}
                  </span>
                  <span className="text-sm font-medium">{candidate?.name ?? "—"}</span>
                  <span className="text-xs text-muted-foreground">Round {iv.round}</span>
                </div>
                <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <ModeIcon className="h-3.5 w-3.5" />{INTERVIEW_MODE_LABELS[iv.mode]} · {fmtWhen(iv.scheduledAt)}
                </p>
                {iv.meetingLink && (
                  <a href={iv.meetingLink} target="_blank" rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <ExternalLink className="h-3 w-3" />Join link
                  </a>
                )}
              </div>
            </div>

            {/* The recording — set once the meeting has happened, edited freely after. */}
            <div className="mt-3 border-t border-border pt-3">
              {isEditing ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    autoFocus
                    className="h-8 max-w-sm"
                    placeholder="https://…"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && save(iv._id)}
                  />
                  <Button size="sm" className="h-8" disabled={saving} onClick={() => save(iv._id)}>
                    <Check className="h-3.5 w-3.5" />Save
                  </Button>
                  <Button size="sm" variant="outline" className="h-8" disabled={saving} onClick={() => setEditing(null)}>
                    <X className="h-3.5 w-3.5" />Cancel
                  </Button>
                </div>
              ) : iv.recordingLink ? (
                <div className="flex flex-wrap items-center gap-3">
                  <a href={iv.recordingLink} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                    <Link2 className="h-3.5 w-3.5" />Recording
                  </a>
                  {canEdit && (
                    <button type="button" onClick={() => startEdit(iv)}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      <Pencil className="h-3 w-3" />Change
                    </button>
                  )}
                </div>
              ) : canEdit ? (
                <Button size="sm" variant="outline" onClick={() => startEdit(iv)}>
                  <Link2 className="h-3.5 w-3.5" />Add recording
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">No recording yet.</span>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
