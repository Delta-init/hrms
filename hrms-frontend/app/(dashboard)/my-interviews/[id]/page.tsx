"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, Check, ClipboardPen, ExternalLink, FileText, Loader2, Lock, MapPin, Pencil, Phone, Video,
} from "lucide-react";
import { useMySheet, useSaveSheet, type SaveSheetBody } from "@/hooks/useInterviews";
import { PageHeader } from "@/components/shared/PageHeader";
import { RECOMMENDATION_TONE, percentTone } from "@/components/hiring/InterviewResults";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  INTERVIEW_MODE_LABELS, RECOMMENDATION_LABELS,
  type InterviewMode, type InterviewSheetPage, type Recommendation,
} from "@/types";

const MODE_ICON: Record<InterviewMode, React.ElementType> = { video: Video, in_person: MapPin, phone: Phone };
const RECOMMENDATIONS: Recommendation[] = ["strong_yes", "yes", "no", "strong_no"];
const fmtWhen = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: tz, timeZoneName: "short",
  }).format(new Date(iso));
const fmtTime = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(d);
const show = (n: number | null) => (n == null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1));

/** What is in the boxes — marks as typed, so "7." survives on its way to "7.5". */
interface Draft {
  answers: Record<string, { response: string; marks: string }>;
  recommendation: Recommendation | null;
  notes: string;
}

/** Whole or half marks, from 0 to the question's maximum. */
const markOk = (text: string, max: number) => {
  if (!text.trim()) return false;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 && n <= max && Number.isInteger(n * 2);
};

const draftFrom = (page: InterviewSheetPage): Draft => ({
  answers: Object.fromEntries((page.sheet?.answers ?? []).map((a) => [a.questionId, { response: a.response, marks: a.marks == null ? "" : String(a.marks) }])),
  recommendation: page.sheet?.recommendation ?? null,
  notes: page.sheet?.notes ?? "",
});

/**
 * One panellist's sheet for one interview: the role's questions with what a
 * good answer covers, a box for what the candidate actually said, and the
 * marks out of each question's maximum.
 *
 * It saves itself as a draft while they type, so a closed tab costs nothing,
 * and nobody else sees it until it is submitted. Submitting needs every
 * question answered and marked, and a recommendation. A submitted sheet can be
 * changed by submitting again — until an offer is in motion, when it freezes.
 */
export default function MyInterviewSheetPage() {
  const { id } = useParams();
  const interviewId = String(id);
  const { data: page, isLoading, error } = useMySheet(interviewId);
  const { mutate: save, isPending } = useSaveSheet();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingSubmitted, setEditingSubmitted] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saveState, setSaveState] = useState<{ kind: "idle" | "saving" | "saved" | "error"; at?: Date }>({ kind: "idle" });
  /** Bumped on every keystroke; a save only clears `dirty` if nothing was typed while it was in flight. */
  const version = useRef(0);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { if (page && !draft) setDraft(draftFrom(page)); }, [page, draft]);

  const submitted = page?.sheet?.status === "submitted";
  const editable = !!page && !page.locked && (!submitted || editingSubmitted);

  const bodyOf = (d: Draft): Omit<SaveSheetBody, "submit"> => ({
    answers: (page?.questions ?? []).map((q) => {
      const a = d.answers[q._id];
      return { questionId: q._id, response: a?.response ?? "", marks: a && markOk(a.marks, q.maxMarks) ? Number(a.marks) : null };
    }),
    recommendation: d.recommendation,
    notes: d.notes,
  });

  // A draft saves itself a moment after they stop typing. A submitted sheet
  // being changed does not — saving it back to a draft would pull a verdict out
  // of HR's results halfway through an edit.
  useEffect(() => {
    if (!dirty || !draft || !page || page.locked || submitted) return;
    const at = version.current;
    const t = setTimeout(() => {
      setSaveState({ kind: "saving" });
      save({ id: interviewId, ...bodyOf(draft), submit: false }, {
        onSuccess: () => { setSaveState({ kind: "saved", at: new Date() }); if (version.current === at) setDirty(false); },
        onError: () => setSaveState({ kind: "error" }),
      });
    }, 1200);
    return () => clearTimeout(t);
    // bodyOf reads `page` and `draft`, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, draft, page, submitted, interviewId, save]);

  if (isLoading || (page && !draft)) {
    return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (error || !page || !draft) {
    const message = (error as { response?: { data?: { message?: string } } } | null)?.response?.data?.message ?? "This interview sheet could not be loaded.";
    return (
      <div className="space-y-4">
        <BackLink />
        <Card className="flex items-start gap-3 p-6">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <p className="text-sm text-muted-foreground">{message}</p>
        </Card>
      </div>
    );
  }

  const change = (next: Draft) => { version.current += 1; setDraft(next); setDirty(true); };
  const setAnswer = (qid: string, patch: Partial<Draft["answers"][string]>) =>
    change({ ...draft, answers: { ...draft.answers, [qid]: { ...(draft.answers[qid] ?? { response: "", marks: "" }), ...patch } } });

  const { interview, candidate, role, questions } = page;
  const ModeIcon = MODE_ICON[interview.mode];
  const missing = questions.flatMap((q, i) => {
    const a = draft.answers[q._id];
    return !a?.response.trim() || !markOk(a.marks, q.maxMarks) ? [i + 1] : [];
  });
  const maxTotal = questions.reduce((n, q) => n + q.maxMarks, 0);
  const total = questions.reduce((n, q) => {
    const a = draft.answers[q._id];
    return n + (a && markOk(a.marks, q.maxMarks) ? Number(a.marks) : 0);
  }, 0);
  const percent = maxTotal ? Math.round((total / maxTotal) * 100) : null;

  const submit = () => {
    setShowErrors(true);
    if (missing.length) {
      toast.error(`Fill in what was said and the marks for question${missing.length === 1 ? "" : "s"} ${missing.join(", ")}`);
      document.getElementById(`answer-${questions[missing[0] - 1]._id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!draft.recommendation) {
      toast.error("Give your overall recommendation");
      document.getElementById("overall")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    save({ id: interviewId, ...bodyOf(draft), submit: true }, {
      onSuccess: (next) => { setEditingSubmitted(false); setDirty(false); setShowErrors(false); setDraft(draftFrom(next)); },
    });
  };

  return (
    <div className="space-y-6 pb-24">
      <BackLink />
      <PageHeader title={candidate.name} description={`${role.title} · Round ${interview.round}${interview.title ? ` · ${interview.title}` : ""}`} icon={ClipboardPen} />

      <Card className="grid grid-cols-1 gap-3 p-4 text-sm sm:grid-cols-2">
        <p className="flex items-center gap-2"><ModeIcon className="h-4 w-4 text-muted-foreground" />{INTERVIEW_MODE_LABELS[interview.mode]} · {fmtWhen(interview.scheduledAt, interview.timeZone)}</p>
        <p className="text-muted-foreground">Panel: {interview.panel.map((p) => p.name).join(", ") || "—"}</p>
        {interview.meetingLink && (
          <a href={interview.meetingLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline">
            <ExternalLink className="h-3.5 w-3.5" />Join the call
          </a>
        )}
        {interview.mode === "in_person" && interview.location && <p className="text-muted-foreground">Where: {interview.location}</p>}
        {candidate.resumeUrl && (
          <a href={candidate.resumeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline">
            <FileText className="h-3.5 w-3.5" />{candidate.resumeFileName || "CV"}
          </a>
        )}
      </Card>

      {page.locked && (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{page.locked}, so this sheet can no longer change.</span>
        </div>
      )}

      {/* Where they stand, kept in view. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-sm">
        {maxTotal > 0 && (
          <span className={cn("rounded-full px-2.5 py-0.5 font-semibold tabular-nums", percentTone(percent))}>
            {show(total)} / {maxTotal}{percent != null ? ` (${percent}%)` : ""}
          </span>
        )}
        {questions.length > 0 && <span className="text-muted-foreground">{questions.length - missing.length} of {questions.length} marked</span>}
        <span className="ml-auto text-xs text-muted-foreground">
          {submitted && !editingSubmitted
            ? `Submitted ${page.sheet?.submittedAt ? fmtWhen(page.sheet.submittedAt, interview.timeZone) : ""}`
            : editingSubmitted ? "Changing your submitted sheet — submit again to keep the changes"
            : saveState.kind === "saving" || (isPending && !submitted) ? "Saving…"
            : saveState.kind === "error" ? "Not saved — check your connection"
            : saveState.kind === "saved" && saveState.at ? `Draft saved ${fmtTime(saveState.at)}`
            : page.sheet ? "Draft — only you can see it" : "Nothing entered yet"}
        </span>
      </div>

      {!questions.length && (
        <Card className="p-4 text-sm text-muted-foreground">
          This role has no interview questions, so there is nothing to mark one by one — give your overall recommendation below.
        </Card>
      )}

      {/* A submitted sheet reads back the questions as they were asked; while
          editing, the role's current questions, carrying the answers over. */}
      <div className="space-y-3">
        {(editable ? questions : (page.sheet?.answers ?? []).map((a) => ({ _id: a.questionId, question: a.question, expectedAnswer: a.expectedAnswer, maxMarks: a.maxMarks }))).map((q, i) => {
          const a = draft.answers[q._id] ?? { response: "", marks: "" };
          const noResponse = showErrors && !a.response.trim();
          const badMark = showErrors ? !markOk(a.marks, q.maxMarks) : !!a.marks.trim() && !markOk(a.marks, q.maxMarks);
          return (
            <Card key={q._id} id={`answer-${q._id}`} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{i + 1}. {q.question}</p>
                <span className="shrink-0 text-xs text-muted-foreground">out of {q.maxMarks}</span>
              </div>
              <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
                <p className="mb-0.5 font-medium text-muted-foreground">Expected answer</p>
                <p className="whitespace-pre-wrap">{q.expectedAnswer}</p>
              </div>
              {editable ? (
                <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                  <div className="space-y-1">
                    <Label htmlFor={`r-${q._id}`} className="text-xs">What the candidate said</Label>
                    <Textarea id={`r-${q._id}`} rows={3} maxLength={4000} value={a.response}
                      className={cn(noResponse && "border-destructive")}
                      onChange={(e) => setAnswer(q._id, { response: e.target.value })} />
                    {noResponse && <p className="text-[11px] text-destructive">Write down what they said</p>}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`m-${q._id}`} className="text-xs">Marks (0–{q.maxMarks})</Label>
                    <Input id={`m-${q._id}`} inputMode="decimal" value={a.marks} placeholder={`of ${q.maxMarks}`}
                      className={cn("tabular-nums", badMark && "border-destructive")}
                      onChange={(e) => setAnswer(q._id, { marks: e.target.value.replace(",", ".") })} />
                    {badMark && <p className="text-[11px] text-destructive">0 to {q.maxMarks}, whole or half marks</p>}
                  </div>
                </div>
              ) : (
                <div className="grid gap-2 text-sm sm:grid-cols-[1fr_auto]">
                  <p className="whitespace-pre-wrap"><span className="text-xs font-medium text-muted-foreground">Said: </span>{a.response || "—"}</p>
                  <span className="self-start font-semibold tabular-nums">{a.marks || "—"} / {q.maxMarks}</span>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Card id="overall" className="space-y-3 p-4">
        <p className="font-medium">Overall</p>
        <div className="flex flex-wrap gap-2">
          {RECOMMENDATIONS.map((r) => (
            <button
              key={r}
              type="button"
              disabled={!editable}
              onClick={() => change({ ...draft, recommendation: r })}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors disabled:cursor-default",
                draft.recommendation === r ? RECOMMENDATION_TONE[r] : "border-border text-muted-foreground hover:bg-muted",
                draft.recommendation === r && "ring-1 ring-current"
              )}
            >
              {draft.recommendation === r && <Check className="mr-1 inline h-3.5 w-3.5" />}{RECOMMENDATION_LABELS[r]}
            </button>
          ))}
        </div>
        {showErrors && !draft.recommendation && <p className="text-[11px] text-destructive">Choose one</p>}
        <div className="space-y-1">
          <Label htmlFor="notes" className="text-xs">Notes (optional)</Label>
          {editable ? (
            <Textarea id="notes" rows={3} maxLength={4000} value={draft.notes} onChange={(e) => change({ ...draft, notes: e.target.value })}
              placeholder="Anything else the hiring team should know" />
          ) : (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{draft.notes || "—"}</p>
          )}
        </div>
      </Card>

      {!page.locked && (
        <div className="flex flex-wrap justify-end gap-2">
          {submitted && !editingSubmitted ? (
            <Button variant="outline" onClick={() => setEditingSubmitted(true)}><Pencil className="h-4 w-4" />Change my marks</Button>
          ) : (
            <>
              {editingSubmitted && (
                <Button variant="outline" disabled={isPending}
                  onClick={() => { setEditingSubmitted(false); setDirty(false); setShowErrors(false); setDraft(draftFrom(page)); }}>
                  Cancel
                </Button>
              )}
              <Button onClick={submit} disabled={isPending}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}{editingSubmitted ? "Submit changes" : "Submit sheet"}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/my-interviews" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" />My Interviews
    </Link>
  );
}
