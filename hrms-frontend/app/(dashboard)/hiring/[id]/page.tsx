"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Plus, FileText, Loader2, XCircle, ChevronRight, Users, AlertTriangle,
  CalendarPlus, CalendarCheck, Video, MapPin, UserPlus,
} from "lucide-react";
import { useRequisitions } from "@/hooks/useHiring";
import { usePipeline, useCandidates, useApplyCandidate, useMoveApplication } from "@/hooks/useCandidates";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { CandidateDialog } from "@/components/hiring/CandidateDialog";
import { ScheduleInterviewDialog } from "@/components/hiring/ScheduleInterviewDialog";
import { HireDialog } from "@/components/hiring/HireDialog";
import { PipelineBoard } from "@/components/hiring/PipelineBoard";
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
  INTERVIEW_STATUS_LABELS,
  type Application, type Candidate,
} from "@/types";

const nameOf = (v: unknown) => (v && typeof v === "object" ? (v as { name?: string }).name ?? "—" : "—");
const asCandidate = (v: Application["candidate"]): Candidate | null => (v && typeof v === "object" ? v : null);

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
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
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
        </>
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
