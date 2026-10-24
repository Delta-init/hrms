"use client";
import { useMemo, useState } from "react";
import {
  CalendarClock, CheckCheck, ClipboardCheck, DoorOpen, FileClock, Link2, Loader2, MapPin, Search, Star, Users, Video,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, getInitials } from "@/lib/utils";
import { REVIEW_OUTCOME_LABELS, type MeetingBooking } from "@/types";

/** The join link opens this long before the start — the join page holds the same line. */
const OPENS_BEFORE_MS = 10 * 60_000;
/** Late, for the joined count: the same five minutes the meeting's attendance uses. */
const LATE_GRACE_MIN = 5;

type Range = "upcoming" | "past" | "all";
type Stage = "cancelled" | "acknowledged" | "written" | "pending" | "live" | "today" | "scheduled";

const nameOf = (v: unknown) => (v && typeof v === "object" ? String((v as { name?: string }).name ?? "") : "");
const idOf = (v: unknown) => (v && typeof v === "object" ? String((v as { _id?: string })._id ?? "") : String(v ?? ""));
const field = (v: unknown, k: string) => (v && typeof v === "object" ? String((v as Record<string, unknown>)[k] ?? "") : "");
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const hm = (d: string) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Where a review stands, in the words the badge uses. */
function stageOf(b: MeetingBooking, now: number): Stage {
  if (b.status === "cancelled") return "cancelled";
  if (b.review?.acknowledgedAt) return "acknowledged";
  if (b.review?.writtenAt) return "written";
  const start = new Date(b.start).getTime(), end = new Date(b.end).getTime();
  if (now >= end) return "pending";
  if (now >= start) return "live";
  if (sameDay(new Date(b.start), new Date(now))) return "today";
  return "scheduled";
}

const STAGE: Record<Stage, { label: string; tone: string }> = {
  scheduled: { label: "Scheduled", tone: "border-border bg-muted/50 text-muted-foreground" },
  today: { label: "Today", tone: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  live: { label: "In progress", tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  pending: { label: "Held · review form not written", tone: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  written: { label: "Review written · waiting for acknowledgement", tone: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400" },
  acknowledged: { label: "Acknowledged", tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  cancelled: { label: "Cancelled", tone: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400" },
};

interface Props {
  reviews: MeetingBooking[];
  loading: boolean;
  me: string;
  isSuperAdmin: boolean;
  onOpen: (b: MeetingBooking) => void;
  onWrite: (b: MeetingBooking) => void;
  onAcknowledge: (id: string) => void;
  acknowledging: boolean;
}

/**
 * Review meetings on their own, as a list rather than blocks on the room
 * calendar: who is reviewed, by whom, when and where, and how far it has got —
 * held, written up, acknowledged. Only the reviews this person may see; the
 * calendar's anonymous "Review meeting" slots are not listed.
 */
export function ReviewMeetingsTab({ reviews, loading, me, isSuperAdmin, onOpen, onWrite, onAcknowledge, acknowledging }: Props) {
  const [range, setRange] = useState<Range>("upcoming");
  const [search, setSearch] = useState("");
  const now = Date.now();

  const counts = useMemo(() => {
    const c = { upcoming: 0, today: 0, pending: 0, written: 0, done: 0 };
    for (const b of reviews) {
      const s = stageOf(b, now);
      if (b.status !== "cancelled" && new Date(b.end).getTime() > now) c.upcoming++;
      if (b.status !== "cancelled" && sameDay(new Date(b.start), new Date(now))) c.today++;
      if (s === "pending") c.pending++;
      if (s === "written") c.written++;
      if (s === "acknowledged") c.done++;
    }
    return c;
  }, [reviews, now]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reviews
      .filter((b) => (range === "upcoming" ? b.status !== "cancelled" && new Date(b.end).getTime() > now : range === "past" ? new Date(b.end).getTime() <= now : true))
      .filter((b) => !q || [nameOf(b.reviewee), nameOf(b.revieweeUser), field(b.reviewee, "employeeCode"), nameOf(b.organizer), b.title]
        .some((s) => s.toLowerCase().includes(q)))
      .sort((a, b) => (range === "upcoming" ? 1 : -1) * (new Date(a.start).getTime() - new Date(b.start).getTime()));
  }, [reviews, range, search, now]);

  // Grouped by day, in the order shown.
  const groups = useMemo(() => {
    const out: Array<{ day: string; items: MeetingBooking[] }> = [];
    for (const b of rows) {
      const day = new Date(b.start).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      const last = out[out.length - 1];
      if (last?.day === day) last.items.push(b); else out.push({ day, items: [b] });
    }
    return out;
  }, [rows]);

  const tiles: Array<{ label: string; value: number; icon: React.ElementType; tone: string }> = [
    { label: "Upcoming", value: counts.upcoming, icon: CalendarClock, tone: "text-sky-600" },
    { label: "Today", value: counts.today, icon: Video, tone: "text-primary" },
    { label: "Review form not written", value: counts.pending, icon: FileClock, tone: "text-amber-600" },
    { label: "Waiting for acknowledgement", value: counts.written, icon: ClipboardCheck, tone: "text-violet-600" },
    { label: "Done", value: counts.done, icon: CheckCheck, tone: "text-emerald-600" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <Card key={t.label} className="p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><t.icon className={cn("h-3.5 w-3.5", t.tone)} />{t.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{t.value}</p>
          </Card>
        ))}
      </div>

      <Card className="flex flex-wrap items-center gap-2 p-3">
        <div className="flex overflow-hidden rounded-md border border-border">
          {(["upcoming", "past", "all"] as Range[]).map((r) => (
            <button key={r} type="button" onClick={() => setRange(r)}
              className={cn("px-3 py-1 text-xs capitalize", range === r ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
              {r}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employee or reviewer…" className="h-8 pl-8 text-sm" />
        </div>
      </Card>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : groups.length === 0 ? (
        <Card className="py-16 text-center text-sm text-muted-foreground">
          {search ? "No review meetings match that." : range === "upcoming" ? "No review meetings coming up." : "No review meetings here."}
        </Card>
      ) : (
        groups.map((g) => (
          <section key={g.day} className="space-y-2">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.day}</h3>
            {g.items.map((b) => (
              <ReviewCard key={b._id} b={b} now={now} me={me} isSuperAdmin={isSuperAdmin}
                onOpen={onOpen} onWrite={onWrite} onAcknowledge={onAcknowledge} acknowledging={acknowledging} />
            ))}
          </section>
        ))
      )}
    </div>
  );
}

function ReviewCard({ b, now, me, isSuperAdmin, onOpen, onWrite, onAcknowledge, acknowledging }: {
  b: MeetingBooking; now: number; me: string; isSuperAdmin: boolean;
  onOpen: (b: MeetingBooking) => void; onWrite: (b: MeetingBooking) => void; onAcknowledge: (id: string) => void; acknowledging: boolean;
}) {
  const stage = stageOf(b, now);
  const who = nameOf(b.reviewee) || nameOf(b.revieweeUser) || b.title;
  const code = field(b.reviewee, "employeeCode");
  const role = field(b.reviewee, "designation");
  const start = new Date(b.start).getTime(), end = new Date(b.end).getTime();
  const isReviewer = idOf(b.organizer) === me || isSuperAdmin;
  const isReviewee = idOf(b.revieweeUser) === me;
  const canJoin = b.mode === "online" && b.status === "booked" && (b.meetingLink || b.hasLink) && now >= start - OPENS_BEFORE_MS && now <= end;
  const canWrite = isReviewer && b.status === "booked" && now >= start && !b.review?.acknowledgedAt;
  const canAck = isReviewee && !!b.review?.writtenAt && !b.review?.acknowledgedAt;

  // Who came in through HRMS, for those shown it: first join per person.
  const attendance = (() => {
    if (!b.joinsVisible || b.mode !== "online") return null;
    const invited = new Set([idOf(b.organizer), ...b.participants.map(idOf)].filter(Boolean));
    const first = new Map<string, number>();
    for (const j of b.joins ?? []) {
      const id = idOf(j.user);
      const late = j.lateMinutes ?? Math.max(0, Math.floor((new Date(j.at).getTime() - start) / 60_000));
      if (!first.has(id)) first.set(id, late);
    }
    if (!first.size && now < start) return null;
    const late = Array.from(first.values()).filter((m) => m > LATE_GRACE_MIN).length;
    return `${first.size}/${invited.size} joined${late ? ` · ${late} late` : ""}`;
  })();

  const where = b.mode === "online"
    ? { icon: Video, text: "Online" }
    : b.mode === "place"
      ? { icon: MapPin, text: b.placeAddress || "Elsewhere" }
      : { icon: DoorOpen, text: nameOf(b.room) || "Room" };

  return (
    <Card
      role="button" tabIndex={0}
      onClick={() => onOpen(b)}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(b); }}
      className={cn("cursor-pointer p-4 transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary", stage === "cancelled" && "opacity-60")}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{getInitials(who)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cn("font-semibold", stage === "cancelled" && "line-through")}>{who}</span>
            {code && <span className="text-xs text-muted-foreground">{code}</span>}
            <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", STAGE[stage].tone)}>{STAGE[stage].label}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {role ? `${role} · ` : ""}Reviewer: {nameOf(b.organizer) || "—"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 font-medium text-foreground tabular-nums"><CalendarClock className="h-3.5 w-3.5" />{hm(b.start)} – {hm(b.end)}</span>
            <span className="inline-flex min-w-0 items-center gap-1"><where.icon className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{where.text}</span></span>
            {attendance && <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{attendance}</span>}
          </div>
          {b.review?.writtenAt && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex" aria-label={`${b.review.rating ?? 0} of 5`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} className={cn("h-3.5 w-3.5", n <= (b.review?.rating ?? 0) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30")} />
                ))}
              </span>
              {b.review.outcome && <span className="font-medium">{REVIEW_OUTCOME_LABELS[b.review.outcome]}</span>}
            </div>
          )}
        </div>

        {/* Actions — the card itself opens the details. */}
        <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {canJoin && <Button asChild size="sm"><a href={`/meet/${b._id}`}><Video className="h-3.5 w-3.5" />Join</a></Button>}
          {b.mode === "place" && b.placeMapUrl && (
            <Button asChild size="sm" variant="outline"><a href={b.placeMapUrl} target="_blank" rel="noopener noreferrer"><MapPin className="h-3.5 w-3.5" />Maps</a></Button>
          )}
          {canWrite && (
            <Button size="sm" variant={b.review?.writtenAt ? "outline" : "default"} onClick={() => onWrite(b)}>
              <ClipboardCheck className="h-3.5 w-3.5" />{b.review?.writtenAt ? "Edit review" : "Write review"}
            </Button>
          )}
          {canAck && (
            <Button size="sm" disabled={acknowledging} onClick={() => onAcknowledge(b._id)}><CheckCheck className="h-3.5 w-3.5" />Acknowledge</Button>
          )}
          {b.recordingLink && (
            <Button asChild size="sm" variant="ghost"><a href={b.recordingLink} target="_blank" rel="noopener noreferrer"><Link2 className="h-3.5 w-3.5" />Recording</a></Button>
          )}
        </div>
      </div>
    </Card>
  );
}
