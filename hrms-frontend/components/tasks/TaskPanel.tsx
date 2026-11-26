"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Paperclip, Pencil, RotateCcw, X, XCircle } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn, getInitials } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useTask, useToggleTaskStep, useSubmitTask, useReviewTask, useCancelTask } from "@/hooks/useTasks";
import { StatusPill, Progress, DueLine, PriorityText, wasSentBack, HISTORY_WORDS } from "./shared";
import type { Task } from "@/types";

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";

/**
 * One task, for everyone who can open it (2026-11-25). The assignee ticks steps and marks it done; HR approves or
 * sends it back, edits or cancels it. What each person sees follows from who they are, not from where they came in.
 */
export function TaskPanel({ taskId, onOpenChange, onEdit }: { taskId: string | null; onOpenChange: (open: boolean) => void; onEdit?: (t: Task) => void }) {
  const { user, hasPermission } = useAuth();
  const { data: task, isLoading } = useTask(taskId);
  const { mutate: toggle, isPending: toggling, variables: toggleVars } = useToggleTaskStep();
  const { mutate: submit, isPending: submitting } = useSubmitTask();
  const { mutate: review, isPending: reviewing } = useReviewTask();
  const { mutate: cancel, isPending: cancelling } = useCancelTask();

  const [note, setNote] = useState("");
  // Several documents at once (2026-11-26: "submit all your credentials"), up to 10.
  const [files, setFiles] = useState<File[]>([]);
  const [finishing, setFinishing] = useState(false);
  const [reason, setReason] = useState("");
  const [sendingBack, setSendingBack] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setNote(""); setFiles([]); setFinishing(false); setReason(""); setSendingBack(false); setConfirmCancel(false); setError(""); }, [taskId]);

  const mine = !!task && !!user?._id && task.assigneeUser === user._id;
  const canApprove = hasPermission("tasks", "approve") && !mine;
  const canEdit = hasPermission("tasks", "edit");
  const working = !!task && mine && (task.status === "todo" || task.status === "in_progress");
  const openSteps = task ? task.steps.filter((s) => !s.done).length : 0;
  const lastReview = task?.reviews?.at(-1);
  // What has been handed in so far — every round's documents; an older server gives only the one file.
  const handedIn = task
    ? task.submission.files ?? (task.submission.fileName ? [{ name: task.submission.fileName, url: task.submission.fileUrl, at: task.submission.at }] : [])
    : [];
  const addFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    const all = [...files, ...picked];
    setFiles(all.slice(0, 10));
    setError(all.length > 10 ? "At most 10 files at a time — the first 10 are kept." : "");
  };

  const markDone = () => {
    if (!task) return;
    if (openSteps && note.trim().length < 3) { setError(`${openSteps} step${openSteps === 1 ? " isn't" : "s aren't"} ticked. Tick ${openSteps === 1 ? "it" : "them"}, or say why in the note.`); return; }
    if (task.proofRequired && !files.length && !handedIn.length) { setError("Attach a photo or file as proof."); return; }
    setError("");
    submit({ id: task._id, note: note.trim() || undefined, files }, { onSuccess: () => { setFinishing(false); setNote(""); setFiles([]); } });
  };

  const sendBack = () => {
    if (!task) return;
    if (reason.trim().length < 3) { setError("Say what needs doing again."); return; }
    setError("");
    review({ id: task._id, decision: "send_back", note: reason.trim() }, { onSuccess: () => { setSendingBack(false); setReason(""); } });
  };

  return (
    <ResponsiveDialog open={!!taskId} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[88vh] overflow-y-auto">
        {isLoading || !task ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle className="flex flex-wrap items-center gap-2 pr-6">{task.title}<StatusPill task={task} /></ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-1 sm:px-0">
                {task.category && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{task.category.name}</span>}
                <DueLine task={task} />
                <PriorityText p={task.priority} />
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>

            <div className="space-y-5 px-4 pb-4 sm:px-0">
              {wasSentBack(task) && lastReview && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
                  <p className="font-medium">Sent back by {lastReview.byName || "HR"}</p>
                  <p className="mt-0.5">{lastReview.note}</p>
                </div>
              )}

              {!mine && (
                <div className="flex items-center gap-2 text-sm">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{getInitials(task.assignee?.name ?? "?")}</div>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{task.assignee?.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{[task.assignee?.designation, task.viaDepartment ? `via ${task.viaDepartment.name}` : null].filter(Boolean).join(" · ") || "Assigned"}</p>
                  </div>
                </div>
              )}

              {task.details && <p className="whitespace-pre-wrap text-sm">{task.details}</p>}

              {task.steps.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between"><p className="text-xs font-medium text-muted-foreground">Steps</p><Progress task={task} wide /></div>
                  <ul className="space-y-1.5">
                    {task.steps.map((s) => {
                      const busy = toggling && toggleVars?.stepId === s._id;
                      return (
                        <li key={s._id}>
                          <button
                            type="button"
                            disabled={!working || busy}
                            onClick={() => toggle({ id: task._id, stepId: s._id, done: !s.done })}
                            className={cn(
                              "flex w-full items-start gap-3 rounded-lg border border-border px-3 py-2.5 text-left text-sm transition-colors",
                              working ? "hover:bg-muted/50" : "cursor-default",
                              s.done && "bg-muted/30"
                            )}
                            aria-pressed={s.done}
                          >
                            <span className={cn("mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border-2",
                              s.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40")}>
                              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : s.done ? <CheckCircle2 className="h-3 w-3" /> : null}
                            </span>
                            <span className={cn("min-w-0 flex-1", s.done && "text-muted-foreground line-through")}>{s.title}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* What was handed in — always shown once marked done, so an empty submission is plain to see (2026-11-26). */}
              {task.submission.at && task.status !== "todo" && (
                <div className="space-y-1.5 rounded-xl border border-border p-3 text-sm">
                  <p className="text-xs font-medium text-muted-foreground">Marked done {when(task.submission.at)}</p>
                  {task.submission.note && <p className="whitespace-pre-wrap">{task.submission.note}</p>}
                  {handedIn.length ? (
                    <ul className="space-y-1">
                      <li className="text-xs font-medium text-muted-foreground">Documents ({handedIn.length})</li>
                      {handedIn.map((f, i) => (
                        <li key={`${f.url}-${i}`} className="flex items-center gap-1.5">
                          <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          {f.url
                            ? <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-primary hover:underline">{f.name}</a>
                            : <span className="min-w-0 truncate text-muted-foreground">{f.name}</span>}
                          {f.at && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{when(f.at)}</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400"><Paperclip className="h-3.5 w-3.5" />Nothing attached</p>
                  )}
                </div>
              )}

              {/* The assignee's way out: Mark done. */}
              {working && !finishing && (
                <Button className="w-full" onClick={() => setFinishing(true)}>
                  <CheckCircle2 className="h-4 w-4" />Mark done
                </Button>
              )}
              {working && finishing && (
                <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="done-note">Note {openSteps ? "*" : "(optional)"}</Label>
                    <Textarea id="done-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                      placeholder={openSteps ? `Why ${openSteps === 1 ? "one step isn't" : `${openSteps} steps aren't`} ticked` : "Anything HR should know"} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Documents {task.proofRequired && !handedIn.length ? "*" : "(optional)"}</Label>
                    <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" className="hidden"
                      onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
                    {!!handedIn.length && <p className="text-xs text-muted-foreground">{handedIn.length} handed in before {handedIn.length === 1 ? "stays" : "stay"} — add any more here.</p>}
                    {files.map((f, i) => (
                      <div key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm">
                        <Paperclip className="h-3.5 w-3.5 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{f.name}</span>
                        <button type="button" onClick={() => setFiles((now) => now.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="rounded p-0.5 hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                    {files.length < 10 && (
                      <Button type="button" variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
                        <Paperclip className="h-4 w-4" />{files.length ? "Add another file" : "Attach photos or PDFs"}
                      </Button>
                    )}
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => { setFinishing(false); setError(""); }}>Back</Button>
                    <Button className="flex-1" onClick={markDone} disabled={submitting}>
                      {submitting && <Loader2 className="h-4 w-4 animate-spin" />}{task.needsApproval ? "Send to HR" : "Mark done"}
                    </Button>
                  </div>
                </div>
              )}
              {mine && task.status === "submitted" && (
                <p className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">Waiting for HR to approve. You&apos;ll get a notice when they decide.</p>
              )}

              {/* HR's decision. */}
              {canApprove && task.status === "submitted" && !sendingBack && (
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1 text-destructive" onClick={() => setSendingBack(true)}><RotateCcw className="h-4 w-4" />Send back</Button>
                  <Button className="flex-1" disabled={reviewing} onClick={() => review({ id: task._id, decision: "approve" })}>
                    {reviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Approve
                  </Button>
                </div>
              )}
              {canApprove && task.status === "submitted" && sendingBack && (
                <div className="space-y-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
                  <Label htmlFor="redo-why">What needs doing again? *</Label>
                  <Textarea id="redo-why" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Media Cabin isn't covered. Add the 3 chairs and the TV." autoFocus />
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => { setSendingBack(false); setError(""); }}>Back</Button>
                    <Button variant="destructive" className="flex-1" disabled={reviewing} onClick={sendBack}>{reviewing && <Loader2 className="h-4 w-4 animate-spin" />}Send back</Button>
                  </div>
                </div>
              )}

              {canEdit && task.status !== "done" && task.status !== "cancelled" && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  {onEdit && <Button size="sm" variant="ghost" onClick={() => onEdit(task)}><Pencil className="h-3.5 w-3.5" />Edit</Button>}
                  {!confirmCancel ? (
                    <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirmCancel(true)}><XCircle className="h-3.5 w-3.5" />Cancel task</Button>
                  ) : (
                    <span className="flex items-center gap-2 text-sm">
                      Cancel {task.assignee?.name?.split(" ")[0] ?? "their"}&apos;s copy?
                      <Button size="sm" variant="destructive" disabled={cancelling} onClick={() => cancel({ id: task._id }, { onSuccess: () => setConfirmCancel(false) })}>Yes, cancel</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>No</Button>
                    </span>
                  )}
                </div>
              )}

              {!!task.history?.length && (
                <details className="group">
                  <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">History ({task.history.length})</summary>
                  <ol className="mt-2 space-y-1.5 border-l border-border pl-3">
                    {[...task.history].reverse().map((h, i) => (
                      <li key={i} className="text-xs">
                        <span className="font-medium">{HISTORY_WORDS[h.action] ?? h.action}</span>
                        {h.note ? <span className="text-muted-foreground"> · {h.note}</span> : null}
                        {h.files?.length ? <span className="block text-muted-foreground"><Paperclip className="mr-1 inline h-3 w-3" />{h.files.join(", ")}</span> : null}
                        <span className="block text-muted-foreground">{[h.byName, when(h.at)].filter(Boolean).join(" · ")}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
