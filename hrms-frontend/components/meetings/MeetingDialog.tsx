"use client";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateBooking, useUpdateBooking, useInvitablePeople } from "@/hooks/useMeetings";
import type { MeetingBooking, MeetingRoom } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rooms: MeetingRoom[];
  booking?: MeetingBooking | null;
  /** Pre-filled when the grid was clicked on an empty hour. */
  startAt?: Date | null;
  /** What a new booking starts as — "review" from the New review meeting button. */
  initialKind?: "meeting" | "review";
}

/** `datetime-local` wants local wall-clock, not an ISO instant. */
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const idOf = (v: unknown) => (v && typeof v === "object" ? String((v as { _id: string })._id) : String(v ?? ""));

export function MeetingDialog({ open, onOpenChange, rooms, booking, startAt, initialKind = "meeting" }: Props) {
  const isEditing = !!booking;
  const { mutate: create, isPending: creating } = useCreateBooking();
  const { mutate: update, isPending: updating } = useUpdateBooking();
  const { data: people = [] } = useInvitablePeople(open);
  const isPending = creating || updating;

  const [title, setTitle] = useState("");
  const [room, setRoom] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [agenda, setAgenda] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  // Review meetings: who is reviewed, and where — online, a room, or elsewhere.
  const [kind, setKind] = useState<"meeting" | "review">("meeting");
  const [mode, setMode] = useState<"room" | "online" | "place">("room");
  const [reviewee, setReviewee] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [placeAddress, setPlaceAddress] = useState("");
  const [placeMapUrl, setPlaceMapUrl] = useState("");

  useEffect(() => {
    if (!open) return;
    setSearch("");
    if (booking) {
      setKind(booking.kind ?? "meeting");
      setMode(booking.mode ?? "room");
      setReviewee(idOf(booking.revieweeUser));
      setMeetingLink(booking.meetingLink ?? "");
      setPlaceAddress(booking.placeAddress ?? "");
      setPlaceMapUrl(booking.placeMapUrl ?? "");
      setTitle(booking.title);
      setRoom(idOf(booking.room));
      setStart(toLocalInput(new Date(booking.start)));
      setEnd(toLocalInput(new Date(booking.end)));
      setAgenda(booking.agenda ?? "");
      setParticipants(booking.participants.map(idOf));
    } else {
      const from = startAt ?? new Date();
      const to = new Date(from.getTime() + 60 * 60_000);
      setTitle(""); setRoom(rooms[0]?._id ?? "");
      setStart(toLocalInput(from)); setEnd(toLocalInput(to));
      setAgenda(""); setParticipants([]);
      setKind(initialKind); setMode(initialKind === "review" && !rooms.length ? "online" : "room");
      setReviewee(""); setMeetingLink(""); setPlaceAddress(""); setPlaceMapUrl("");
    }
  }, [open, booking, startAt, rooms, initialKind]);

  const isReview = kind === "review";
  const effectiveMode = isReview ? mode : "room";
  const linkOk = (v: string) => /^https?:\/\//i.test(v.trim());
  // Someone other than the organiser is never shown the link; blank keeps it.
  const keepsHiddenLink = isEditing && !!booking?.hasLink && !meetingLink.trim();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => p.name.toLowerCase().includes(q) || (p.employeeCode ?? "").toLowerCase().includes(q));
  }, [people, search]);

  const submit = () => {
    const payload = {
      title, agenda,
      kind, mode: effectiveMode,
      room: effectiveMode === "room" ? room : null,
      meetingLink: effectiveMode === "online" ? meetingLink.trim() : "",
      placeAddress: effectiveMode === "place" ? placeAddress.trim() : "",
      placeMapUrl: effectiveMode === "place" ? placeMapUrl.trim() : "",
      revieweeUser: isReview ? reviewee : null,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      participants,
    };
    if (isEditing) update({ id: booking._id, data: payload }, { onSuccess: () => onOpenChange(false) });
    else create(payload, { onSuccess: () => onOpenChange(false) });
  };

  const toggle = (id: string) =>
    setParticipants((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const field = "space-y-1.5";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[90vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{isEditing ? "Edit meeting" : isReview ? "Schedule a review meeting" : "Book a room"}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="grid grid-cols-2 gap-4 px-4 sm:px-0">
          <div className={`${field} col-span-2`}>
            <Label htmlFor="m-title">Title *</Label>
            <Input id="m-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Monthly review" />
          </div>

          <div className={`${field} col-span-2`}>
            <Label>Type</Label>
            <div className="flex overflow-hidden rounded-md border border-border">
              {(["meeting", "review"] as const).map((k) => (
                <button key={k} type="button" disabled={isEditing} onClick={() => setKind(k)}
                  className={`flex-1 px-3 py-1.5 text-sm ${kind === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"} disabled:opacity-60`}>
                  {k === "meeting" ? "Meeting" : "Review meeting"}
                </button>
              ))}
            </div>
            {isReview && <p className="text-[11px] text-muted-foreground">A review of one employee. After it, you fill in the review form and can add the recording.</p>}
          </div>

          {isReview && (
            <div className={`${field} col-span-2`}>
              <Label>Employee being reviewed *</Label>
              <Select value={reviewee} onValueChange={setReviewee}>
                <SelectTrigger><SelectValue placeholder="Choose the employee" /></SelectTrigger>
                <SelectContent>
                  {people.map((p) => (
                    <SelectItem key={p._id} value={p._id}>{p.name}{p.employeeCode ? ` · ${p.employeeCode}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {isReview && (
            <div className={`${field} col-span-2`}>
              <Label>Where</Label>
              <div className="flex overflow-hidden rounded-md border border-border">
                {([["online", "Online"], ["room", "Meeting room"], ["place", "Other place"]] as const).map(([m, l]) => (
                  <button key={m} type="button" onClick={() => setMode(m)} disabled={m === "room" && !rooms.length}
                    className={`flex-1 px-3 py-1.5 text-sm ${mode === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"} disabled:opacity-50`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}

          {effectiveMode === "online" && (
            <div className={`${field} col-span-2`}>
              <Label htmlFor="m-link">Meeting link *</Label>
              <Input id="m-link" value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)}
                placeholder={booking?.hasLink ? "Leave blank to keep the current link" : "https://meet.google.com/… or Zoom / Teams link"} />
              {meetingLink && !linkOk(meetingLink) && <p className="text-xs text-destructive">Must start with http:// or https://</p>}
            </div>
          )}

          {effectiveMode === "place" && (
            <>
              <div className={`${field} col-span-2`}>
                <Label htmlFor="m-place">Address / location *</Label>
                <Input id="m-place" value={placeAddress} onChange={(e) => setPlaceAddress(e.target.value)} maxLength={300} placeholder="e.g. Floor 3, Business Bay Tower B, Dubai" />
              </div>
              <div className={`${field} col-span-2`}>
                <Label htmlFor="m-map">Google Maps link</Label>
                <Input id="m-map" value={placeMapUrl} onChange={(e) => setPlaceMapUrl(e.target.value)} placeholder="Optional — https://maps.google.com/…" />
                {placeMapUrl && !linkOk(placeMapUrl) && <p className="text-xs text-destructive">Must start with http:// or https://</p>}
              </div>
            </>
          )}

          {effectiveMode === "room" && (
          <div className={`${field} col-span-2`}>
            <Label>Room *</Label>
            <Select value={room} onValueChange={setRoom}>
              <SelectTrigger><SelectValue placeholder={rooms.length ? "Choose a room" : "No rooms yet"} /></SelectTrigger>
              <SelectContent>
                {rooms.map((r) => (
                  <SelectItem key={r._id} value={r._id}>
                    {r.name}{r.capacity ? ` · seats ${r.capacity}` : ""}{r.location ? ` · ${r.location}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          )}

          <div className={field}>
            <Label htmlFor="m-start">Starts *</Label>
            <Input id="m-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className={field}>
            <Label htmlFor="m-end">Ends *</Label>
            <Input id="m-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>

          <div className={`${field} col-span-2`}>
            <Label>Participants</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employees…" />
            </div>
            {participants.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {participants.map((id) => {
                  const p = people.find((x) => x._id === id);
                  return (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 py-0.5 pl-2 pr-1 text-xs">
                      {p?.name ?? "…"}
                      <button type="button" onClick={() => toggle(id)} className="rounded-full p-0.5 hover:bg-destructive/10 hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="max-h-44 overflow-y-auto rounded-md border border-border">
              {filtered.length === 0 ? (
                <p className="p-3 text-center text-xs text-muted-foreground">Nobody matches that.</p>
              ) : (
                filtered.map((p) => (
                  <button
                    key={p._id}
                    type="button"
                    onClick={() => toggle(p._id)}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-muted/50"
                  >
                    <span>{p.name}{p.employeeCode ? <span className="ml-1.5 text-xs text-muted-foreground">{p.employeeCode}</span> : null}</span>
                    {participants.includes(p._id) && <span className="text-xs text-primary">added</span>}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className={`${field} col-span-2`}>
            <Label htmlFor="m-agenda">Agenda</Label>
            <Textarea id="m-agenda" rows={2} value={agenda} onChange={(e) => setAgenda(e.target.value)} placeholder="Optional" />
          </div>

          <ResponsiveDialogFooter className="col-span-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={
              isPending || !title.trim() || !start || !end ||
              (effectiveMode === "room" && !room) ||
              (effectiveMode === "online" && !linkOk(meetingLink) && !keepsHiddenLink) ||
              (effectiveMode === "place" && (!placeAddress.trim() || (!!placeMapUrl && !linkOk(placeMapUrl)))) ||
              (isReview && !reviewee)
            }>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEditing ? "Save changes" : isReview ? "Schedule review" : "Book room"}
            </Button>
          </ResponsiveDialogFooter>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
