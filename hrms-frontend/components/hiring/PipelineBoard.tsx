"use client";
import { useState } from "react";
import Link from "next/link";
import {
  FileText, FileWarning, Video, MapPin, CalendarPlus, CalendarCheck,
  XCircle, PauseCircle, RotateCcw, UserPlus, GripVertical, ShieldCheck, ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getInitials, cn } from "@/lib/utils";
import {
  APPLICATION_STAGES, STAGE_LABELS, INTERVIEW_STATUS_LABELS,
  type Application, type ApplicationStage, type Candidate,
} from "@/types";

/**
 * The pipeline, as a board you can drag on.
 *
 * Native HTML5 drag and drop rather than a library: the whole interaction is
 * "pick up a card, drop it on a column", which needs no collision detection,
 * no virtual list and no new dependency. The stage buttons stay as well, because
 * dragging is unusable from a keyboard and awkward on a phone.
 */

const asCandidate = (v: Application["candidate"]): Candidate | null => (v && typeof v === "object" ? v : null);
const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** Columns exclude `hired`: that is reached by creating the employee record. */
const COLUMNS = APPLICATION_STAGES.filter((s) => s !== "hired");

interface Props {
  columns: { stage: ApplicationStage; applications: Application[] }[];
  closed: Application[];
  canEdit: boolean;
  busy: boolean;
  onMove: (id: string, stage: ApplicationStage) => void;
  onReject: (app: Application) => void;
  onWaitlist: (app: Application) => void;
  onRestore: (id: string) => void;
  onSchedule: (app: Application) => void;
  onHire: (app: Application) => void;
}

export function PipelineBoard({
  columns, closed, canEdit, busy, onMove, onReject, onWaitlist, onRestore, onSchedule, onHire,
}: Props) {
  const [dragging, setDragging] = useState<Application | null>(null);
  const [over, setOver] = useState<ApplicationStage | null>(null);

  const drop = (stage: ApplicationStage) => {
    if (dragging && dragging.stage !== stage) onMove(dragging._id, stage);
    setDragging(null);
    setOver(null);
  };

  return (
    <div className="space-y-4">
      {/* One horizontal scroller rather than a wrapping grid: columns that wrap
          stop reading as a pipeline the moment the second row appears. */}
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
        {columns.map((col) => {
          const isTarget = over === col.stage && dragging?.stage !== col.stage;
          return (
            <section
              key={col.stage}
              onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(col.stage); } }}
              onDragLeave={() => setOver((s) => (s === col.stage ? null : s))}
              onDrop={(e) => { e.preventDefault(); drop(col.stage); }}
              className={cn(
                "flex w-[260px] shrink-0 flex-col rounded-2xl border bg-muted/30 p-2.5 transition",
                isTarget ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "border-border"
              )}
            >
              <header className="mb-2 flex items-center justify-between px-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {STAGE_LABELS[col.stage]}
                </span>
                <span className="rounded-full bg-background px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {col.applications.length}
                </span>
              </header>

              {/* A minimum height so an empty column is still a drop target and
                  the board keeps its shape rather than collapsing to a strip. */}
              <div className="flex min-h-[280px] flex-1 flex-col gap-2">
                {col.applications.map((app) => (
                  <Card
                    key={app._id}
                    app={app}
                    canEdit={canEdit}
                    busy={busy}
                    dragging={dragging?._id === app._id}
                    onDragStart={() => setDragging(app)}
                    onDragEnd={() => { setDragging(null); setOver(null); }}
                    onMove={onMove}
                    onReject={onReject}
                    onWaitlist={onWaitlist}
                    onSchedule={onSchedule}
                    onHire={onHire}
                  />
                ))}
                {col.applications.length === 0 && (
                  <p className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border text-[11px] text-muted-foreground">
                    {isTarget ? "Drop here" : "Nobody here"}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {/* Parked and closed, side by side. A pipeline that hides either looks
          healthier than it is, and both can be brought back. */}
      {closed.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <ClosedLane
            title="Waiting list"
            tone="text-sky-600"
            apps={closed.filter((a) => a.status === "waitlisted")}
            canEdit={canEdit}
            busy={busy}
            onRestore={onRestore}
            empty="Nobody parked."
          />
          <ClosedLane
            title="Out of the running"
            tone="text-muted-foreground"
            apps={closed.filter((a) => a.status !== "waitlisted")}
            canEdit={canEdit}
            busy={busy}
            onRestore={onRestore}
            empty="Nobody turned down."
          />
        </div>
      )}
    </div>
  );
}

function Card({
  app, canEdit, busy, dragging, onDragStart, onDragEnd, onMove, onReject, onWaitlist, onSchedule, onHire,
}: {
  app: Application; canEdit: boolean; busy: boolean; dragging: boolean;
  onDragStart: () => void; onDragEnd: () => void;
  onMove: (id: string, stage: ApplicationStage) => void;
  onReject: (a: Application) => void;
  onWaitlist: (a: Application) => void;
  onSchedule: (a: Application) => void;
  onHire: (a: Application) => void;
}) {
  const c = asCandidate(app.candidate);
  const live = (app.interviews ?? []).filter((i) => i.status !== "cancelled");
  const next = live.find((i) => new Date(i.scheduledAt) >= new Date()) ?? live.at(-1);
  const offer = app.offerApproval?.status;

  return (
    <article
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group rounded-xl border border-border bg-card p-2.5 shadow-sm transition",
        canEdit && "cursor-grab active:cursor-grabbing hover:shadow-md",
        dragging && "opacity-40"
      )}
    >
      <div className="flex items-start gap-2">
        {canEdit && <GripVertical className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />}
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
          {getInitials(c?.name ?? "?")}
        </div>
        <div className="min-w-0 flex-1">
          <Link href={`/hiring/candidates/${c?._id}`} className="block truncate text-sm font-medium hover:underline">
            {c?.name ?? "—"}
          </Link>
          <div className="truncate text-[11px] text-muted-foreground">{c?.currentCompany || c?.email}</div>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
        {/* Whether a CV is on file at all — the first thing anyone screening asks. */}
        {c?.resumeUrl ? (
          <a href={c.resumeUrl} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            <FileText className="h-3 w-3" />CV
          </a>
        ) : (
          <span className="inline-flex items-center gap-1 text-amber-600"><FileWarning className="h-3 w-3" />No CV</span>
        )}
        {c?.expectedSalary ? <span className="text-muted-foreground">{c.currency} {c.expectedSalary}</span> : null}
        {c?.noticePeriodDays != null ? <span className="text-muted-foreground">{c.noticePeriodDays}d notice</span> : null}
      </div>

      {next ? (
        <div className="mt-1.5 flex items-center gap-1 text-[10px] text-sky-600">
          {next.mode === "video" ? <Video className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
          <span className="truncate">R{next.round} {INTERVIEW_STATUS_LABELS[next.status].toLowerCase()} · {shortDate(next.scheduledAt)}</span>
        </div>
      ) : (
        <div className="mt-1.5 text-[10px] text-muted-foreground">No interview scheduled</div>
      )}

      {/* An offer cannot go out until management has released it, so the card
          says where that stands rather than leaving somebody to guess. */}
      {app.stage === "offer" && offer && offer !== "not_requested" && (
        <div className={cn("mt-1.5 flex items-center gap-1 text-[10px]",
          offer === "approved" ? "text-emerald-600" : offer === "pending" ? "text-amber-600" : "text-red-600")}>
          {offer === "approved" ? <ShieldCheck className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
          {offer === "approved" ? "Offer approved" : offer === "pending" ? "Awaiting management" : "Offer refused"}
        </div>
      )}

      {canEdit && (
        <div className="mt-2 flex items-center gap-1">
          {app.stage === "accepted" ? (
            <Button size="sm" className="h-7 flex-1 text-[11px]" disabled={busy} onClick={() => onHire(app)}>
              <UserPlus className="h-3 w-3" />Hire
            </Button>
          ) : (
            <select
              aria-label="Move to stage"
              className="h-7 flex-1 rounded-md border border-border bg-background px-1.5 text-[11px]"
              value={app.stage}
              disabled={busy}
              onChange={(e) => onMove(app._id, e.target.value as ApplicationStage)}
            >
              {COLUMNS.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
            </select>
          )}
          <Button size="sm" variant="ghost" className="h-7 px-1.5" disabled={busy}
            onClick={() => onSchedule(app)} aria-label="Schedule an interview" title="Schedule an interview">
            {live.length ? <CalendarCheck className="h-3.5 w-3.5 text-sky-600" /> : <CalendarPlus className="h-3.5 w-3.5" />}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-1.5 text-sky-600" disabled={busy}
            onClick={() => onWaitlist(app)} aria-label="Move to the waiting list" title="Waiting list">
            <PauseCircle className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-1.5 text-destructive" disabled={busy}
            onClick={() => onReject(app)} aria-label="Reject" title="Reject">
            <XCircle className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </article>
  );
}

function ClosedLane({
  title, tone, apps, canEdit, busy, onRestore, empty,
}: {
  title: string; tone: string; apps: Application[]; canEdit: boolean; busy: boolean;
  onRestore: (id: string) => void; empty: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className={cn("mb-2 text-xs font-semibold uppercase tracking-wide", tone)}>
        {title} ({apps.length})
      </p>
      {apps.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-1.5">
          {apps.map((app) => {
            const c = asCandidate(app.candidate);
            return (
              <div key={app._id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <Link href={`/hiring/candidates/${c?._id}`} className="font-medium hover:underline">{c?.name ?? "—"}</Link>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {STAGE_LABELS[app.stage]}{app.rejectionReason ? ` — ${app.rejectionReason}` : ""}
                  </span>
                  {canEdit && (
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" disabled={busy}
                      onClick={() => onRestore(app._id)}>
                      <RotateCcw className="h-3 w-3" />Bring back
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
