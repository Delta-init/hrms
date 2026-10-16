"use client";
import { useMemo, useState } from "react";
import { MonitorPlay, CalendarDays, ChevronLeft, ChevronRight, DoorOpen, Loader2, Plus, Pencil, Trash2, Ban, Video, MapPin, Link2, ClipboardCheck, Star, Check, UserCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { MeetingWeekGrid } from "@/components/meetings/MeetingWeekGrid";
import { MeetingDialog } from "@/components/meetings/MeetingDialog";
import { RoomsDialog } from "@/components/meetings/RoomsDialog";
import { BoardLinkDialog } from "@/components/meetings/BoardLinkDialog";
import { ReviewMeetingDialog } from "@/components/meetings/ReviewMeetingDialog";
import { useAuth } from "@/hooks/useAuth";
import {
  useMeetingRooms, useMeetingBookings, useCancelBooking, useDeleteBooking, useSetRecording, useAcknowledgeReview,
} from "@/hooks/useMeetings";
import { REVIEW_OUTCOME_LABELS, type MeetingBooking } from "@/types";

const ALL = "__all__";
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => { const o = new Date(d); o.setDate(o.getDate() + n); return o; };
/** Monday-first, matching the work week everywhere else in this app. */
const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const nameOf = (v: unknown) => (v && typeof v === "object" ? String((v as { name?: string }).name ?? "") : "");
const idOf = (v: unknown) => (v && typeof v === "object" ? String((v as { _id: string })._id) : String(v ?? ""));

/** The join link opens this long before an online review starts. */
const JOIN_OPENS_BEFORE_MS = 10 * 60_000;
/** Joining up to this many minutes after the start still counts as on time. */
const LATE_GRACE_MIN = 5;

type Join = NonNullable<MeetingBooking["joins"]>[number];

/** Everybody in an online review — reviewer first — with the first time each came in through HRMS. */
function attendees(b: MeetingBooking): Array<{ id: string; name: string; join: Join | null; joinCount: number }> {
  const people = [b.organizer, ...b.participants];
  const seen = new Set<string>();
  const joins = [...(b.joins ?? [])].sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime());
  return people.flatMap((p) => {
    const id = idOf(p);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const mine = joins.filter((j) => idOf(j.user) === id);
    return [{ id, name: nameOf(p) || "—", join: mine[0] ?? null, joinCount: mine.length }];
  });
}

function Chip({ tone, children }: { tone: "ok" | "warn" | "muted"; children: React.ReactNode }) {
  const cls = tone === "ok"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : tone === "warn"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
      : "border-border text-muted-foreground";
  return <span className={`rounded-full border px-2 py-0.5 ${cls}`}>{children}</span>;
}

export default function MeetingsPage() {
  const { hasPermission, user } = useAuth();
  const canView = hasPermission("meetings", "view");
  const canBook = hasPermission("meetings", "create");
  // The rooms themselves are an administrator's job, not a booker's.
  const canManageRooms = hasPermission("meetings", "edit");

  const [mode, setMode] = useState<"day" | "week">("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [room, setRoom] = useState(ALL);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [editing, setEditing] = useState<MeetingBooking | null>(null);
  const [pickedStart, setPickedStart] = useState<Date | null>(null);
  const [detail, setDetail] = useState<MeetingBooking | null>(null);
  const [cancelTarget, setCancelTarget] = useState<MeetingBooking | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MeetingBooking | null>(null);
  const [newKind, setNewKind] = useState<"meeting" | "review">("meeting");
  const [reviewing, setReviewing] = useState<MeetingBooking | null>(null);
  const [recording, setRecording] = useState("");
  const { mutate: saveRecording, isPending: savingRecording } = useSetRecording();
  const { mutate: acknowledge, isPending: acknowledging } = useAcknowledgeReview();

  const days = useMemo(() => {
    if (mode === "day") return [startOfDay(anchor)];
    const from = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(from, i));
  }, [mode, anchor]);

  const { data: rooms = [] } = useMeetingRooms();
  const params = useMemo(() => {
    const from = days[0]!;
    const to = addDays(days[days.length - 1]!, 1);
    return { from: from.toISOString(), to: to.toISOString(), ...(room !== ALL ? { room } : {}) };
  }, [days, room]);
  const { data: bookings = [], isLoading } = useMeetingBookings(params);

  // The open detail follows the list, so a saved review or recording shows at once.
  const shown = detail ? bookings.find((b) => b._id === detail._id) ?? detail : null;
  const { mutate: cancel, isPending: cancelling } = useCancelBooking();
  const { mutate: remove, isPending: deleting } = useDeleteBooking();

  /**
   * Whether the buttons are worth showing. The server decides for real — this
   * only avoids offering somebody a button that will refuse them.
   */
  const canManage = (b: MeetingBooking) =>
    idOf(b.organizer) === String(user?._id) || !!user?.isDepartmentHead || hasPermission("meetings", "edit");

  const label = mode === "day"
    ? anchor.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : `${days[0]!.toLocaleDateString([], { day: "numeric", month: "short" })} – ${days[6]!.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}`;

  if (!canView) {
    return <Card className="p-16 text-center text-muted-foreground">You do not have access to meeting rooms.</Card>;
  }

  return (
    <div>
      <PageHeader
        title="Meeting Rooms"
        description="Who has which room, and when. Click an empty slot to book it."
        icon={CalendarDays}
        action={canView && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" className="shadow-sm" onClick={() => setBoardOpen(true)}>
              <MonitorPlay className="h-4 w-4" />Public board
            </Button>
            {canManageRooms && (
              <Button variant="outline" className="shadow-sm" onClick={() => setRoomsOpen(true)}>
                <DoorOpen className="h-4 w-4" />Rooms
              </Button>
            )}
            {canBook && (
              <Button variant="outline" className="shadow-sm" onClick={() => { setEditing(null); setPickedStart(null); setNewKind("review"); setDialogOpen(true); }}>
                <ClipboardCheck className="h-4 w-4" />Review meeting
              </Button>
            )}
            {canBook && rooms.length > 0 && (
              <Button className="shadow-sm" onClick={() => { setEditing(null); setPickedStart(null); setNewKind("meeting"); setDialogOpen(true); }}>
                <Plus className="h-4 w-4" />Book a room
              </Button>
            )}
          </div>
        )}
      />

      <Card className="mb-4 flex flex-wrap items-center gap-3 p-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-8 w-8"
            onClick={() => setAnchor((d) => addDays(d, mode === "day" ? -1 : -7))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setAnchor(new Date())}>Today</Button>
          <Button variant="outline" size="icon" className="h-8 w-8"
            onClick={() => setAnchor((d) => addDays(d, mode === "day" ? 1 : 7))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <span className="text-sm font-medium">{label}</span>

        <div className="ml-auto flex items-center gap-2">
          <Select value={room} onValueChange={setRoom}>
            <SelectTrigger className="h-8 w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All rooms</SelectItem>
              {rooms.map((r) => <SelectItem key={r._id} value={r._id}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex overflow-hidden rounded-md border border-border">
            {(["day", "week"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-3 py-1 text-xs capitalize ${mode === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                {m}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card className="p-2">
        {rooms.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {canManageRooms
                ? "No rooms yet. Add one and the calendar fills in around it."
                : "No rooms yet. An administrator adds them before anything can be booked."}
            </p>
            {canManageRooms && (
              <Button className="mt-4" onClick={() => setRoomsOpen(true)}>
                <Plus className="h-4 w-4" />Add a room
              </Button>
            )}
          </div>
        ) : isLoading ? (
          <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <MeetingWeekGrid
            days={days}
            bookings={bookings}
            onSelect={setDetail}
            onPick={canBook ? (at) => { setEditing(null); setPickedStart(at); setNewKind("meeting"); setDialogOpen(true); } : undefined}
          />
        )}
      </Card>

      <MeetingDialog open={dialogOpen} onOpenChange={setDialogOpen} rooms={rooms} booking={editing} startAt={pickedStart} initialKind={newKind} />
      <ReviewMeetingDialog open={!!reviewing} onOpenChange={(o) => !o && setReviewing(null)} booking={reviewing} />
      <RoomsDialog open={roomsOpen} onOpenChange={setRoomsOpen} />
      <BoardLinkDialog open={boardOpen} onOpenChange={setBoardOpen} canReset={canManageRooms} />

      {/* Detail — who booked it, who is coming, and what may be done about it. */}
      <ResponsiveDialog open={!!shown} onOpenChange={(o) => { if (!o) { setDetail(null); setRecording(""); } }}>
        <ResponsiveDialogContent desktopClassName="max-w-md max-h-[90vh] overflow-y-auto">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{shown?.title}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          {shown && (() => {
            const isReview = shown.kind === "review";
            const me = String(user?._id);
            const isOrganizer = idOf(shown.organizer) === me || user?.role?.roleName === "Super Admin";
            const isReviewee = idOf(shown.revieweeUser) === me;
            const started = new Date(shown.start).getTime() <= Date.now();
            // The join link opens ten minutes before and closes at the end — the server holds the same line.
            const opensAt = new Date(shown.start).getTime() - JOIN_OPENS_BEFORE_MS;
            const ended = new Date(shown.end).getTime() < Date.now();
            const joinable = shown.status === "booked" && Date.now() >= opensAt && !ended;
            const r = shown.review;
            return (
            <div className="space-y-3 px-4 pb-4 text-sm sm:px-0">
              <p className="text-muted-foreground">
                {new Date(shown.start).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {" – "}
                {new Date(shown.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
              {shown.restricted ? (
                <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">A review meeting. Only the people in it, their department head and HR can see the details.</p>
              ) : (<>
              <div className="grid grid-cols-[120px_1fr] gap-y-1.5">
                {isReview && (<><span className="text-muted-foreground">Reviewing</span><span className="font-medium">{nameOf(shown.reviewee) || nameOf(shown.revieweeUser) || "—"}</span></>)}
                <span className="text-muted-foreground">Where</span>
                <span>
                  {shown.mode === "online" ? "Online" : shown.mode === "place" ? shown.placeAddress : nameOf(shown.room) || "—"}
                </span>
                <span className="text-muted-foreground">{isReview ? "Reviewer" : "Booked by"}</span><span>{nameOf(shown.organizer) || "—"}</span>
                <span className="text-muted-foreground">Status</span>
                <span className="capitalize">{shown.status === "cancelled" ? "cancelled" : isReview && r?.writtenAt ? "held" : shown.status}</span>
              </div>
              {shown.mode === "online" && (shown.meetingLink || shown.hasLink) && shown.status === "booked" && !joinable && !ended && (
                <p className="text-xs text-muted-foreground">
                  The join link opens at {new Date(opensAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} and is emailed to everyone as it starts.
                </p>
              )}
              {(shown.mode === "online" && (shown.meetingLink || shown.hasLink) && joinable) || (shown.mode === "place" && shown.placeMapUrl) ? (
                <div className="flex flex-wrap gap-2">
                  {/* Through HRMS's join page — location first, then the meeting. */}
                  {shown.mode === "online" && (shown.meetingLink || shown.hasLink) && joinable && (
                    <Button asChild size="sm"><a href={`/meet/${shown._id}`}><Video className="h-3.5 w-3.5" />Join meeting</a></Button>
                  )}
                  {shown.mode === "place" && shown.placeMapUrl && (
                    <Button asChild size="sm" variant="outline"><a href={shown.placeMapUrl} target="_blank" rel="noopener noreferrer"><MapPin className="h-3.5 w-3.5" />Open in Maps</a></Button>
                  )}
                </div>
              ) : null}
              {shown.agenda && <p className="rounded-md bg-muted/40 p-2">{shown.agenda}</p>}
              <div>
                <p className="mb-1 text-muted-foreground">Participants ({shown.participants.length})</p>
                {shown.participants.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nobody else invited.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {shown.participants.map((p, i) => (
                      <span key={idOf(p) || i} className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs">
                        {nameOf(p) || "—"}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Everyone invited: when they first came in through HRMS, how late, and whether they were where they clocked in. */}
              {isReview && shown.mode === "online" && shown.joinsVisible && shown.status === "booked" && Date.now() >= opensAt && (
                <div className="border-t border-border pt-3">
                  <p className="mb-1 text-muted-foreground">Attendance</p>
                  <div className="space-y-1.5">
                    {attendees(shown).map(({ id, name, join, joinCount }) => {
                      if (!join) {
                        return (
                          <div key={id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-medium">{name}</span>
                            <Chip tone="muted">{ended ? "Not joined" : "Not joined yet"}</Chip>
                          </div>
                        );
                      }
                      const late = join.lateMinutes ?? Math.max(0, Math.floor((new Date(join.at).getTime() - new Date(shown.start).getTime()) / 60_000));
                      return (
                        <div key={id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-medium">{name}
                            <span className="ml-1.5 font-normal text-muted-foreground">
                              {new Date(join.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{joinCount > 1 ? ` · opened ${joinCount}×` : ""}
                            </span>
                          </span>
                          <span className="flex flex-wrap gap-1">
                            {late <= LATE_GRACE_MIN ? <Chip tone="ok">On time</Chip> : <Chip tone="warn">{late} min late</Chip>}
                            {!join.clockedIn ? (
                              <Chip tone="warn">Not clocked in today</Chip>
                            ) : join.sameLocation ? (
                              <Chip tone="ok">Same place as clock-in{join.distanceMetres != null ? ` (${join.distanceMetres} m)` : ""}</Chip>
                            ) : join.distanceMetres != null ? (
                              <Chip tone="warn">{join.distanceMetres >= 1000 ? `${(join.distanceMetres / 1000).toFixed(1)} km` : `${join.distanceMetres} m`} from clock-in</Chip>
                            ) : (
                              <Chip tone="muted">Clock-in had no location</Chip>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* The recording — a link to wherever the meeting tool kept it. */}
              <div className="border-t border-border pt-3">
                <p className="mb-1 text-muted-foreground">Recording</p>
                {shown.recordingLink ? (
                  <a href={shown.recordingLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline">
                    <Link2 className="h-3.5 w-3.5" />Open recording
                  </a>
                ) : canManage(shown) && started && shown.status === "booked" ? (
                  <div className="flex gap-2">
                    <Input className="h-8" value={recording} onChange={(e) => setRecording(e.target.value)} placeholder="https://… link to the recording" />
                    <Button size="sm" className="h-8" disabled={savingRecording || !/^https?:\/\//i.test(recording.trim())}
                      onClick={() => saveRecording({ id: shown._id, recordingLink: recording.trim() }, { onSuccess: () => setRecording("") })}>
                      Save
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">None yet.</p>
                )}
              </div>

              {isReview && (
                <div className="border-t border-border pt-3">
                  <p className="mb-1 text-muted-foreground">Review</p>
                  {r?.writtenAt ? (
                    <div className="space-y-2 rounded-md bg-muted/30 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={n <= (r.rating ?? 0) ? "h-4 w-4 fill-amber-400 text-amber-400" : "h-4 w-4 text-muted-foreground/40"} />)}
                        </span>
                        {r.outcome && <span className="rounded-full border border-border px-2 py-0.5 text-xs">{REVIEW_OUTCOME_LABELS[r.outcome]}</span>}
                      </div>
                      {r.strengths && <p><span className="font-medium">Strengths: </span>{r.strengths}</p>}
                      {r.improvements && <p><span className="font-medium">To improve: </span>{r.improvements}</p>}
                      {!!r.actions?.length && (
                        <div>
                          <p className="font-medium">Actions</p>
                          <ul className="ml-4 list-disc">
                            {r.actions.map((a, i) => <li key={i}>{a.text}{a.dueDate ? ` — by ${new Date(a.dueDate).toLocaleDateString([], { day: "numeric", month: "short" })}` : ""}</li>)}
                          </ul>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {r.acknowledgedAt
                          ? <span className="inline-flex items-center gap-1"><UserCheck className="h-3.5 w-3.5" />Acknowledged {new Date(r.acknowledgedAt).toLocaleDateString([], { day: "numeric", month: "short" })}</span>
                          : "Not acknowledged yet"}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{started ? "Not written yet." : "Written after the meeting."}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {isOrganizer && started && shown.status === "booked" && !r?.acknowledgedAt && (
                      <Button size="sm" variant={r?.writtenAt ? "outline" : "default"} onClick={() => setReviewing(shown)}>
                        <ClipboardCheck className="h-3.5 w-3.5" />{r?.writtenAt ? "Edit review" : "Write review"}
                      </Button>
                    )}
                    {isReviewee && r?.writtenAt && !r.acknowledgedAt && (
                      <Button size="sm" disabled={acknowledging} onClick={() => acknowledge(shown._id)}>
                        <Check className="h-3.5 w-3.5" />Acknowledge
                      </Button>
                    )}
                  </div>
                </div>
              )}
              </>)}

              {!shown.restricted && canManage(shown) && shown.status === "booked" && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button size="sm" variant="outline" onClick={() => { setEditing(shown); setPickedStart(null); setDetail(null); setDialogOpen(true); }}>
                    <Pencil className="h-3.5 w-3.5" />Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setCancelTarget(shown)}>
                    <Ban className="h-3.5 w-3.5" />Cancel
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDeleteTarget(shown)}>
                    <Trash2 className="h-3.5 w-3.5" />Delete
                  </Button>
                </div>
              )}
            </div>
            );
          })()}
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ConfirmDialog
        open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}
        title="Cancel this meeting" description="The room frees up and everyone invited is told. The booking stays on the record."
        confirmLabel="Cancel meeting" isPending={cancelling}
        onConfirm={() => cancelTarget && cancel(cancelTarget._id, { onSuccess: () => { setCancelTarget(null); setDetail(null); } })}
      />
      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete this booking" description="Removed entirely, with no record that it was ever made." isPending={deleting}
        onConfirm={() => deleteTarget && remove(deleteTarget._id, { onSuccess: () => { setDeleteTarget(null); setDetail(null); } })}
      />
    </div>
  );
}
