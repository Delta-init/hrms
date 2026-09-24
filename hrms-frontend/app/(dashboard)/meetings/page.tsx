"use client";
import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, DoorOpen, Loader2, Plus, Pencil, Trash2, Ban } from "lucide-react";
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
import { useAuth } from "@/hooks/useAuth";
import {
  useMeetingRooms, useMeetingBookings, useCancelBooking, useDeleteBooking,
} from "@/hooks/useMeetings";
import type { MeetingBooking } from "@/types";

const ALL = "__all__";
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => { const o = new Date(d); o.setDate(o.getDate() + n); return o; };
/** Monday-first, matching the work week everywhere else in this app. */
const startOfWeek = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
const nameOf = (v: unknown) => (v && typeof v === "object" ? String((v as { name?: string }).name ?? "") : "");
const idOf = (v: unknown) => (v && typeof v === "object" ? String((v as { _id: string })._id) : String(v ?? ""));

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
  const [editing, setEditing] = useState<MeetingBooking | null>(null);
  const [pickedStart, setPickedStart] = useState<Date | null>(null);
  const [detail, setDetail] = useState<MeetingBooking | null>(null);
  const [cancelTarget, setCancelTarget] = useState<MeetingBooking | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MeetingBooking | null>(null);

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
        action={(canManageRooms || (canBook && rooms.length > 0)) && (
          <div className="flex items-center gap-2">
            {canManageRooms && (
              <Button variant="outline" className="shadow-sm" onClick={() => setRoomsOpen(true)}>
                <DoorOpen className="h-4 w-4" />Rooms
              </Button>
            )}
            {canBook && rooms.length > 0 && (
              <Button className="shadow-sm" onClick={() => { setEditing(null); setPickedStart(null); setDialogOpen(true); }}>
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
            onPick={canBook ? (at) => { setEditing(null); setPickedStart(at); setDialogOpen(true); } : undefined}
          />
        )}
      </Card>

      <MeetingDialog open={dialogOpen} onOpenChange={setDialogOpen} rooms={rooms} booking={editing} startAt={pickedStart} />
      <RoomsDialog open={roomsOpen} onOpenChange={setRoomsOpen} />

      {/* Detail — who booked it, who is coming, and what may be done about it. */}
      <ResponsiveDialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <ResponsiveDialogContent desktopClassName="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{detail?.title}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          {detail && (
            <div className="space-y-3 px-4 pb-4 text-sm sm:px-0">
              <p className="text-muted-foreground">
                {new Date(detail.start).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {" – "}
                {new Date(detail.end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
              <div className="grid grid-cols-[110px_1fr] gap-y-1.5">
                <span className="text-muted-foreground">Room</span><span>{nameOf(detail.room) || "—"}</span>
                <span className="text-muted-foreground">Booked by</span><span>{nameOf(detail.organizer) || "—"}</span>
                <span className="text-muted-foreground">Status</span>
                <span className="capitalize">{detail.status}</span>
              </div>
              {detail.agenda && <p className="rounded-md bg-muted/40 p-2">{detail.agenda}</p>}
              <div>
                <p className="mb-1 text-muted-foreground">Participants ({detail.participants.length})</p>
                {detail.participants.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nobody else invited.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {detail.participants.map((p, i) => (
                      <span key={idOf(p) || i} className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs">
                        {nameOf(p) || "—"}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {canManage(detail) && detail.status === "booked" && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button size="sm" variant="outline" onClick={() => { setEditing(detail); setPickedStart(null); setDetail(null); setDialogOpen(true); }}>
                    <Pencil className="h-3.5 w-3.5" />Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setCancelTarget(detail)}>
                    <Ban className="h-3.5 w-3.5" />Cancel
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDeleteTarget(detail)}>
                    <Trash2 className="h-3.5 w-3.5" />Delete
                  </Button>
                </div>
              )}
            </div>
          )}
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
