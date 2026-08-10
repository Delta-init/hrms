"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft, Plus, FileText, Loader2, XCircle, ChevronRight, Users, AlertTriangle,
  CalendarPlus, CalendarCheck, Video, MapPin,
} from "lucide-react";
import { useRequisitions } from "@/hooks/useHiring";
import { usePipeline, useCandidates, useApplyCandidate, useMoveApplication } from "@/hooks/useCandidates";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "@/components/shared/PageHeader";
import { CandidateDialog } from "@/components/hiring/CandidateDialog";
import { ScheduleInterviewDialog } from "@/components/hiring/ScheduleInterviewDialog";
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
  const [rejecting, setRejecting] = useState<Application | null>(null);
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
          <div className="grid grid-cols-1 gap-3 overflow-x-auto pb-2 md:grid-cols-3 xl:grid-cols-6">
            {(pipeline?.columns ?? [])
              // Hired is reached by creating the employee record, not by moving a card.
              .filter((c) => c.stage !== "hired")
              .map((col) => (
                <div key={col.stage} className="min-w-[210px] rounded-2xl border border-border bg-card p-3 shadow-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{STAGE_LABELS[col.stage]}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">{col.applications.length}</span>
                  </div>

                  <div className="space-y-2">
                    {col.applications.map((app) => {
                      const c = asCandidate(app.candidate);
                      const next = APPLICATION_STAGES[APPLICATION_STAGES.indexOf(app.stage) + 1];
                      return (
                        <div key={app._id} className="rounded-xl border border-border bg-background p-2.5">
                          <div className="flex items-start gap-2">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                              {getInitials(c?.name ?? "?")}
                            </div>
                            <div className="min-w-0 flex-1">
                              <Link href={`/hiring/candidates/${c?._id}`} className="truncate text-sm font-medium hover:underline">
                                {c?.name ?? "—"}
                              </Link>
                              <div className="truncate text-[11px] text-muted-foreground">{c?.currentCompany || c?.email}</div>
                            </div>
                          </div>

                          {(c?.expectedSalary || c?.noticePeriodDays != null) && (
                            <div className="mt-1.5 flex flex-wrap gap-x-3 text-[10px] text-muted-foreground">
                              {c?.expectedSalary ? <span>wants {c.currency} {c.expectedSalary}</span> : null}
                              {c?.noticePeriodDays != null ? <span>{c.noticePeriodDays}d notice</span> : null}
                            </div>
                          )}

                          {c?.resumeUrl && (
                            <a href={c.resumeUrl} target="_blank" rel="noopener noreferrer"
                              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                              <FileText className="h-3 w-3" />CV
                            </a>
                          )}

                          {/* Whether anyone has actually spoken to them — the
                              question a board is scanned for. */}
                          {(() => {
                            const live = (app.interviews ?? []).filter((i) => i.status !== "cancelled");
                            const next = live.find((i) => new Date(i.scheduledAt) >= new Date()) ?? live.at(-1);
                            return next ? (
                              <div className="mt-1.5 flex items-center gap-1 text-[10px] text-sky-600">
                                {next.mode === "video" ? <Video className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                                <span className="truncate">
                                  R{next.round} {INTERVIEW_STATUS_LABELS[next.status].toLowerCase()} ·{" "}
                                  {new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(next.scheduledAt))}
                                </span>
                              </div>
                            ) : (
                              <div className="mt-1.5 text-[10px] text-muted-foreground">No interview scheduled</div>
                            );
                          })()}

                          {canEdit && (
                            <div className="mt-2 flex items-center gap-1">
                              <Button size="sm" variant="ghost" className="h-7 px-2" disabled={moving}
                                onClick={() => setScheduling(app)} aria-label="Schedule an interview">
                                {(app.interviews ?? []).some((i) => i.status !== "cancelled")
                                  ? <CalendarCheck className="h-3.5 w-3.5 text-sky-600" />
                                  : <CalendarPlus className="h-3.5 w-3.5" />}
                              </Button>
                              {next && next !== "hired" && (
                                <Button size="sm" variant="outline" className="h-7 flex-1 text-[11px]" disabled={moving}
                                  onClick={() => move({ id: app._id, stage: next })}>
                                  {STAGE_LABELS[next]}<ChevronRight className="h-3 w-3" />
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" disabled={moving}
                                onClick={() => { setRejecting(app); setReason(""); }} aria-label="Reject">
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {col.applications.length === 0 && (
                      <p className="py-3 text-center text-[11px] text-muted-foreground">Nobody here</p>
                    )}
                  </div>
                </div>
              ))}
          </div>

          {/* Kept on screen: a pipeline that hides its rejections looks healthier
              than it is, and the reason is the useful part months later. */}
          {!!pipeline?.closed.length && (
            <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Out of the running ({pipeline.closed.length})
              </p>
              <div className="space-y-1.5">
                {pipeline.closed.map((app) => {
                  const c = asCandidate(app.candidate);
                  return (
                    <div key={app._id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium">{c?.name ?? "—"}</span>
                      <span className="text-xs text-muted-foreground">
                        {app.status === "rejected" ? "Rejected" : "Withdrew"} at {STAGE_LABELS[app.stage]}
                        {app.rejectionReason ? ` — ${app.rejectionReason}` : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <AddToPipeline open={addOpen} onOpenChange={setAddOpen} requisitionId={requisitionId} />

      {scheduling && (
        <ScheduleInterviewDialog
          open={!!scheduling}
          onOpenChange={(o) => !o && setScheduling(null)}
          applicationId={scheduling._id}
          candidateName={asCandidate(scheduling.candidate)?.name}
          nextRound={(scheduling.interviews ?? []).filter((i) => i.status !== "cancelled").length + 1}
        />
      )}

      <ResponsiveDialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <ResponsiveDialogContent desktopClassName="max-w-md">
          <ResponsiveDialogHeader><ResponsiveDialogTitle>Reject this candidate?</ResponsiveDialogTitle></ResponsiveDialogHeader>
          <div className="space-y-3 px-4 sm:px-0">
            <div className="space-y-1.5">
              <Label htmlFor="reason">Why? *</Label>
              <Textarea id="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Salary expectations, notice period, experience…" />
              {/* Without it, a rejection six months later is a dead end nobody
                  can explain — and the same person may well apply again. */}
              <p className="text-[11px] text-muted-foreground">Recorded against the candidate, and shown if they apply again.</p>
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button variant="destructive" disabled={!reason.trim() || moving}
              onClick={() => rejecting && move(
                { id: rejecting._id, status: "rejected", reason: reason.trim() },
                { onSuccess: () => setRejecting(null) }
              )}>
              Reject
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
