"use client";
import { useEffect, useState } from "react";
import { Loader2, MapPin, Pencil, Plus, RotateCcw, Users, X } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMeetingRooms, useCreateRoom, useUpdateRoom, useRetireRoom } from "@/hooks/useMeetings";
import { cn } from "@/lib/utils";
import type { MeetingRoom } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const blank = { name: "", location: "", capacity: "", notes: "" };

/**
 * The rooms themselves, before anybody can book one.
 *
 * Retired rooms stay on this list rather than disappearing from it: the only
 * way back from a retirement is to see that it happened, and a room quietly
 * gone is indistinguishable from a room never added.
 */
export function RoomsDialog({ open, onOpenChange }: Props) {
  // Retired ones included — this is the screen where they can be brought back.
  const { data: rooms = [], isLoading } = useMeetingRooms(true);
  const { mutate: create, isPending: creating } = useCreateRoom();
  const { mutate: update, isPending: updating } = useUpdateRoom();
  const { mutate: retire, isPending: retiring } = useRetireRoom();
  const busy = creating || updating || retiring;

  const [editing, setEditing] = useState<MeetingRoom | null>(null);
  const [form, setForm] = useState(blank);
  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open) { setEditing(null); setForm(blank); }
  }, [open]);

  const edit = (r: MeetingRoom) => {
    setEditing(r);
    setForm({
      name: r.name,
      location: r.location ?? "",
      capacity: r.capacity ? String(r.capacity) : "",
      notes: r.notes ?? "",
    });
  };

  const reset = () => { setEditing(null); setForm(blank); };

  const submit = () => {
    const payload = {
      name: form.name.trim(),
      location: form.location.trim(),
      capacity: form.capacity ? Number(form.capacity) : 0,
      notes: form.notes.trim(),
    };
    if (editing) update({ id: editing._id, data: payload }, { onSuccess: reset });
    else create(payload, { onSuccess: reset });
  };

  const field = "space-y-1.5";

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-lg max-h-[90vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Meeting rooms</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-4 px-4 pb-4 sm:px-0">
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : rooms.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No rooms yet. Add the first one below.
            </p>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border">
              {rooms.map((r) => (
                <div key={r._id} className={cn("flex items-center gap-3 p-3", !r.active && "opacity-60")}>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {r.name}
                      {!r.active && (
                        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
                          Retired
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                      {r.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{r.location}</span>}
                      {!!r.capacity && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />seats {r.capacity}</span>}
                      {r.notes && <span className="truncate">{r.notes}</span>}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" className="h-8 px-2" disabled={busy} onClick={() => edit(r)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {r.active ? (
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-muted-foreground" disabled={busy}
                      onClick={() => retire(r._id)}>
                      Retire
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" className="h-8 px-2" disabled={busy}
                      onClick={() => update({ id: r._id, data: { active: true } })}>
                      <RotateCcw className="h-3.5 w-3.5" />Restore
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{editing ? `Editing ${editing.name}` : "Add a room"}</p>
              {editing && (
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={reset}>
                  <X className="h-3.5 w-3.5" />Cancel
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className={`${field} col-span-2`}>
                <Label htmlFor="r-name">Name *</Label>
                <Input id="r-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Boardroom" />
              </div>
              <div className={field}>
                <Label htmlFor="r-location">Where it is</Label>
                <Input id="r-location" value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. 2nd floor" />
              </div>
              <div className={field}>
                <Label htmlFor="r-capacity">Seats</Label>
                <Input id="r-capacity" type="number" min={0} value={form.capacity}
                  onChange={(e) => set("capacity", e.target.value)} placeholder="e.g. 8" />
              </div>
              <div className={`${field} col-span-2`}>
                <Label htmlFor="r-notes">Notes</Label>
                <Textarea id="r-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)}
                  placeholder="Optional — a projector, a whiteboard, anything worth knowing before booking it" />
              </div>
            </div>

            <Button className="w-full" onClick={submit} disabled={busy || !form.name.trim()}>
              {(creating || updating) && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save changes" : <><Plus className="h-4 w-4" />Add room</>}
            </Button>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
