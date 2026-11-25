"use client";
import { useState } from "react";
import { Loader2, Pause, Pencil, Play, Repeat, Square, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useTaskSeriesList, useSetTaskSeriesState } from "@/hooks/useTasks";
import { SeriesDialog } from "./SeriesDialog";
import type { TaskSeries } from "@/types";

const STATE_STYLE: Record<TaskSeries["state"], string> = {
  active: "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  paused: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  ended: "border-border bg-muted text-muted-foreground",
};
const STATE_WORD: Record<TaskSeries["state"], string> = { active: "Running", paused: "Paused", ended: "Ended" };

const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const time12 = (t: string) => { const h = +t.slice(0, 2); return `${h % 12 || 12}:${t.slice(3)} ${h < 12 ? "am" : "pm"}`; };

function endsText(s: TaskSeries) {
  if (s.ends.kind === "count") return `${s.made} of ${s.ends.count} made`;
  if (s.ends.kind === "date" && s.ends.date) return `Until ${day(s.ends.date)} · ${s.made} made`;
  return `No end · ${s.made} made`;
}

/** HR's Repeating tab (Part 2): every series, what it makes next, and pause / resume / stop / edit. */
export function SeriesList({ onShowCopies }: { onShowCopies: (seriesId: string) => void }) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("tasks", "edit");
  const { data: series = [], isLoading } = useTaskSeriesList();
  const { mutate: setState, isPending, variables } = useSetTaskSeriesState();
  const [editing, setEditing] = useState<TaskSeries | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!series.length) {
    return (
      <Card className="py-14 text-center">
        <Repeat className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
        <p className="font-medium">No repeating tasks</p>
        <p className="text-sm text-muted-foreground">Choose Daily, Weekly or Every N days under Repeats when you create a task.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {series.map((s) => {
        const busy = isPending && variables?.id === s._id;
        const people = s.assignees.length;
        return (
          <Card key={s._id} className="flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium leading-snug">{s.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 font-medium text-primary"><Repeat className="h-3 w-3" />{s.repeatText}</span>
                  <span>by {time12(s.dueTime)}</span>
                  {s.category && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">{s.category.name}</span>}
                </p>
              </div>
              <span className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium", STATE_STYLE[s.state])}>{STATE_WORD[s.state]}</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-muted/50 p-2">
                <p className="text-muted-foreground">For</p>
                <p className="flex items-center gap-1 font-medium"><Users className="h-3 w-3" />{people === 1 ? (typeof s.assignees[0].employee === "object" ? s.assignees[0].employee?.name : "1 person") : `${people} people`}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-2">
                <p className="text-muted-foreground">Progress</p>
                <p className="font-medium tabular-nums">{s.copies.done}/{s.copies.total} done{s.copies.open ? ` · ${s.copies.open} open` : ""}</p>
              </div>
            </div>

            <div className="text-xs">
              <p className="text-muted-foreground">{endsText(s)}</p>
              {s.state === "active" && s.next.length > 0 && <p className="mt-0.5 tabular-nums">Next: {s.next.map(day).join(" · ")}</p>}
              {s.state === "paused" && <p className="mt-0.5 text-amber-600 dark:text-amber-400">Paused, nothing is being made. Resuming starts from that day.</p>}
            </div>

            <div className="mt-auto flex flex-wrap gap-1.5 border-t border-border pt-3">
              <Button size="sm" variant="ghost" onClick={() => onShowCopies(s._id)}>See copies</Button>
              {canEdit && s.state !== "ended" && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)}><Pencil className="h-3.5 w-3.5" />Edit</Button>
                  {s.state === "active"
                    ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => setState({ id: s._id, state: "paused" })}><Pause className="h-3.5 w-3.5" />Pause</Button>
                    : <Button size="sm" variant="ghost" disabled={busy} onClick={() => setState({ id: s._id, state: "active" })}><Play className="h-3.5 w-3.5" />Resume</Button>}
                  {stopping === s._id ? (
                    <span className="flex items-center gap-1.5 text-xs">
                      Stop for good?
                      <Button size="sm" variant="destructive" disabled={busy} onClick={() => setState({ id: s._id, state: "ended" }, { onSuccess: () => setStopping(null) })}>Stop</Button>
                      <Button size="sm" variant="ghost" onClick={() => setStopping(null)}>No</Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setStopping(s._id)}><Square className="h-3.5 w-3.5" />Stop</Button>
                  )}
                </>
              )}
            </div>
          </Card>
        );
      })}
      <SeriesDialog series={editing} onOpenChange={(o) => !o && setEditing(null)} />
    </div>
  );
}
