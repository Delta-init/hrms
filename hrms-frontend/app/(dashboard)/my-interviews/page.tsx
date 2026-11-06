"use client";
import Link from "next/link";
import { ChevronRight, ClipboardPen, Loader2, MapPin, Phone, Video } from "lucide-react";
import { useMyInterviews } from "@/hooks/useInterviews";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { INTERVIEW_MODE_LABELS, INTERVIEW_STATUS_LABELS, type InterviewMode, type MyInterview } from "@/types";

const MODE_ICON: Record<InterviewMode, React.ElementType> = { video: Video, in_person: MapPin, phone: Phone };
const fmtWhen = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz,
  }).format(new Date(iso));

/**
 * The interviews this person is on the panel for.
 *
 * Open to anybody on a panel, with or without a hiring permission — the people
 * who interview are mostly not the people who run hiring. Sheets still to do
 * come first, soonest first; the ones already submitted follow.
 */
export default function MyInterviewsPage() {
  const { data = [], isLoading } = useMyInterviews();
  const toMark = data
    .filter((iv) => iv.sheet?.status !== "submitted" && iv.status !== "no_show")
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const done = data.filter((iv) => !toMark.includes(iv));

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Interviews"
        description="Interviews you're on the panel for. Open one to ask the role's questions and mark the answers."
        icon={ClipboardPen}
      />
      {isLoading ? (
        <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !data.length ? (
        <Card className="p-16 text-center text-muted-foreground">You&apos;re not on any interview panel.</Card>
      ) : (
        <>
          <Section title="To mark" empty="Nothing waiting — every sheet is submitted." rows={toMark} />
          {done.length > 0 && <Section title="Done" rows={done} />}
        </>
      )}
    </div>
  );
}

function Section({ title, rows, empty }: { title: string; rows: MyInterview[]; empty?: string }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      {!rows.length && empty ? <p className="text-sm text-muted-foreground">{empty}</p> : null}
      {rows.map((iv) => <Row key={iv._id} iv={iv} />)}
    </section>
  );
}

function Row({ iv }: { iv: MyInterview }) {
  const ModeIcon = MODE_ICON[iv.mode];
  const sheet = iv.sheet;
  const chip = iv.status === "no_show"
    ? { label: INTERVIEW_STATUS_LABELS.no_show, tone: "bg-muted text-muted-foreground" }
    : sheet?.status === "submitted"
      ? { label: sheet.maxTotal != null ? `Submitted · ${sheet.totalMarks} / ${sheet.maxTotal} (${sheet.percent}%)` : "Submitted", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" }
      : sheet
        ? { label: "Draft saved", tone: "bg-sky-500/10 text-sky-700 dark:text-sky-400" }
        : { label: "Not started", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400" };
  return (
    <Link href={`/my-interviews/${iv._id}`}>
      <Card className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/40">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{iv.candidate.name}</span>
            <span className="text-sm text-muted-foreground">{iv.role.title}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", chip.tone)}>{chip.label}</span>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <ModeIcon className="h-3.5 w-3.5" />Round {iv.round} · {INTERVIEW_MODE_LABELS[iv.mode]} · {fmtWhen(iv.scheduledAt, iv.timeZone)}
            {" · "}{iv.questionCount ? `${iv.questionCount} question${iv.questionCount === 1 ? "" : "s"}` : "no questions set"}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Card>
    </Link>
  );
}
