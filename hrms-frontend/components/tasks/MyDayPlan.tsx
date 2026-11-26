"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Clock, GripVertical, Loader2, Lock, Plus } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter, ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toMin } from "@/lib/dayPlan";
import { useDayAction } from "@/hooks/useDayPlans";
import type { DayPlanDayView, DayPlanItem } from "@/types";

/** "13:05" → "1:05 pm". */
export const clock = (hhmm: string) => { const m = toMin(hhmm); const h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
const at = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }) : "");
const nowHHMM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

const DURS = [10, 15, 20, 30, 45, 60];
const QUICK: Array<[string, number]> = [["Clean meeting room after a meeting", 15], ["Urgent cleaning", 15], ["Restock tissues", 10], ["Tea for guests", 10]];

/**
 * His day by the clock (2026-11-26). Tasks follow one another; adding one moves everything after it later, up to
 * the next fixed time. Every area and every checklist item inside it has a tick. Changes are for today only.
 */
export function MyDayPlan({ day }: { day: DayPlanDayView }) {
  const { mutate, isPending, variables } = useDayAction();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ after: string | null } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [now, setNow] = useState(nowHHMM());
  useEffect(() => { const t = setInterval(() => setNow(nowHHMM()), 30_000); return () => clearInterval(t); }, []);

  // Times that just moved flash, with the old time beside them.
  const prev = useRef<Record<string, string>>({});
  const [moved, setMoved] = useState<Record<string, string>>({});
  useEffect(() => {
    const was = prev.current, changed: Record<string, string> = {};
    for (const it of day.items) if (was[it._id] && was[it._id] !== it.start && !it.done) changed[it._id] = was[it._id];
    prev.current = Object.fromEntries(day.items.map((i) => [i._id, i.start]));
    if (Object.keys(changed).length) { setMoved(changed); const t = setTimeout(() => setMoved({}), 3000); return () => clearTimeout(t); }
  }, [day.items]);

  const act = (method: "patch" | "post" | "put" | "delete", url: string, body?: unknown, message?: string) => mutate({ method, url: `${day._id}/${url}`, body, message });
  const reorder = (ids: string[], message: string) => act("put", "order", { ids }, message);
  const move = (i: number, dir: -1 | 1) => {
    const ids = day.items.map((x) => x._id); const j = i + dir;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder(ids, `Moved "${day.items[i].title}" ${dir < 0 ? "earlier" : "later"}`);
  };
  const canSwap = (i: number, dir: -1 | 1) => { const j = i + dir; return j >= 0 && j < day.items.length && !day.items[j].fixedAt && !day.items[i].fixedAt; };

  const nextRound = day.rounds.find((r) => !r.doneAt);
  const roundDue = !!nextRound && toMin(now) >= toMin(nextRound.due) - 10;
  const last = day.items[day.items.length - 1];
  const nowIndex = useMemo(() => day.items.findIndex((it) => toMin(it.start) > toMin(now)), [day.items, now]);
  const busy = (url: string) => isPending && variables?.url === `${day._id}/${url}`;

  return (
    <div className="mx-auto max-w-xl space-y-3">
      <div className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{day.planName ?? "Today"}</h2>
          <span className={cn("text-xs", last?.over ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground")}>
            {last?.over ? `Runs ${last.over} min past ${clock(last.fixedAt ?? last.start)}` : `Finishes ${clock(day.endsAt)}`}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${day.progress.total ? Math.round(day.progress.done / day.progress.total * 100) : 0}%` }} /></div>
          <span className="text-sm tabular-nums text-muted-foreground">{day.progress.done} of {day.progress.total}</span>
        </div>
        {nextRound && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-primary/10 px-3 py-2 text-sm text-primary">
            <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" />Office round {roundDue ? "due now" : `at ${clock(nextRound.due)}`}</span>
            <Button size="sm" disabled={!roundDue || busy("rounds")} onClick={() => act("post", "rounds", { due: nextRound.due }, `Round at ${clock(nextRound.due)} recorded`)}>Round done</Button>
          </div>
        )}
      </div>

      <ol className="space-y-0">
        {day.items.map((it, i) => (
          <li key={it._id}>
            {it.free > 0 && <Gap>{it.free} min free</Gap>}
            {it.over > 0 && <Gap bad>Running {it.over} min into {it.kind === "break" ? "lunch" : it.title}</Gap>}
            {nowIndex === i && <NowLine />}
            <div
              className={cn("relative grid grid-cols-[58px_1fr] gap-2", overId === it._id && dragId !== it._id && "before:absolute before:left-[66px] before:right-0 before:top-0 before:h-0.5 before:rounded before:bg-primary")}
              draggable={!it.fixedAt}
              onDragStart={(e) => { setDragId(it._id); e.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => { setDragId(null); setOverId(null); }}
              onDragOver={(e) => { if (dragId && !it.fixedAt) { e.preventDefault(); setOverId(it._id); } }}
              onDrop={(e) => {
                e.preventDefault();
                if (!dragId || dragId === it._id) return;
                const ids = day.items.map((x) => x._id).filter((x) => x !== dragId);
                ids.splice(ids.indexOf(it._id), 0, dragId);
                reorder(ids, "Moved");
                setDragId(null); setOverId(null);
              }}
            >
              <div className="pt-3 text-right">
                <p className="text-sm font-semibold tabular-nums">{clock(it.start).replace(/ (am|pm)/, "")}</p>
                <p className="text-[10.5px] text-muted-foreground">{clock(it.start).slice(-2)}</p>
                {moved[it._id] && <p className="text-[10.5px] leading-tight text-amber-600 dark:text-amber-400">was {clock(moved[it._id]).replace(/ (am|pm)/, "")}</p>}
              </div>
              <Card item={it} index={i} open={open === it._id} moved={!!moved[it._id]} dragging={dragId === it._id}
                onToggle={() => setOpen(open === it._id ? null : it._id)}
                onTick={(d) => act("patch", `items/${it._id}`, { done: d })}
                onStep={(stepId, d) => act("patch", `items/${it._id}/steps/${stepId}`, { done: d })}
                onMove={(dir) => move(i, dir)} canUp={canSwap(i, -1)} canDown={canSwap(i, 1)}
                onLength={(m) => act("patch", `items/${it._id}/length`, { mins: m }, `"${it.title}" is now ${m} min`)}
                onRemove={() => act("delete", `items/${it._id}`, undefined, `Removed "${it.title}"`)}
                busyTick={busy(`items/${it._id}`)} />
            </div>
            {i < day.items.length - 1 && (
              <div className="grid grid-cols-[58px_1fr] gap-2">
                <button type="button" onClick={() => setAdding({ after: it._id })}
                  className="col-start-2 h-6 rounded-lg border border-dashed border-transparent px-2 text-left text-[11.5px] text-muted-foreground hover:border-primary hover:text-primary focus-visible:border-primary">
                  + add here
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      <Button className="w-full" onClick={() => setAdding({ after: day.items.length > 1 ? day.items[day.items.length - 2]._id : null })}><Plus className="h-4 w-4" />Add a task</Button>
      <p className="text-center text-xs text-muted-foreground">Your changes are for today. Tomorrow starts from HR&apos;s plan again.</p>

      <AddSheet day={day} after={adding?.after ?? null} open={!!adding} onOpenChange={(o) => !o && setAdding(null)}
        onAdd={(title, mins) => act("post", "items", { title, mins, afterId: adding?.after ?? null }, `Added "${title}"`)} />
    </div>
  );
}

function Gap({ children, bad }: { children: React.ReactNode; bad?: boolean }) {
  return <div className="grid grid-cols-[58px_1fr] gap-2"><p className={cn("col-start-2 ml-2 border-l-2 border-dotted py-0.5 pl-3 text-[11.5px]", bad ? "border-red-400 text-red-600 dark:text-red-400" : "border-border text-muted-foreground")}>{children}</p></div>;
}
function NowLine() {
  return <div className="grid grid-cols-[58px_1fr] items-center gap-2 py-1"><span className="text-right text-[10.5px] font-bold text-red-600">NOW</span><span className="relative h-0.5 rounded bg-red-500 before:absolute before:-left-1 before:-top-[3px] before:h-2 before:w-2 before:rounded-full before:bg-red-500" /></div>;
}

function Card({ item: it, open, moved, dragging, onToggle, onTick, onStep, onMove, canUp, canDown, onLength, onRemove, busyTick }: {
  item: DayPlanItem; index: number; open: boolean; moved: boolean; dragging: boolean; onToggle: () => void; onTick: (d: boolean) => void;
  onStep: (stepId: string, d: boolean) => void; onMove: (dir: -1 | 1) => void; canUp: boolean; canDown: boolean;
  onLength: (m: number) => void; onRemove: () => void; busyTick: boolean;
}) {
  const brk = it.kind === "break";
  const stepsDone = it.steps.filter((s) => s.done).length;
  const late = it.done && it.doneAt && it.plannedAt ? (() => { const d = new Date(it.doneAt); return d.getHours() * 60 + d.getMinutes() > toMin(it.end) + 10; })() : false;
  return (
    <div className={cn("my-1 rounded-2xl border bg-card p-3 transition-colors",
      it.fixedAt ? "border-dashed bg-muted/40" : "border-border", it.addedByHim && "border-primary/40",
      moved && "bg-amber-100 dark:bg-amber-900/30", dragging && "opacity-40")}>
      <div className="flex items-center gap-2.5">
        {!brk && (
          <button type="button" aria-pressed={it.done} aria-label={`Mark ${it.title} ${it.done ? "not done" : "done"}`} disabled={busyTick} onClick={() => onTick(!it.done)}
            className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 transition-colors", it.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40 hover:border-emerald-500")}>
            {busyTick ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : it.done ? <Check className="h-3.5 w-3.5" /> : null}
          </button>
        )}
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className={cn("min-w-0 flex-1 font-medium leading-snug", it.done && "text-muted-foreground line-through")}>{it.title}</span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{it.mins} min</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        {!it.fixedAt && <GripVertical className="hidden h-4 w-4 shrink-0 cursor-grab text-muted-foreground sm:block" aria-hidden />}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[34px] text-[11px]">
        {it.fixedAt && <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-muted-foreground"><Lock className="h-2.5 w-2.5" />Fixed time</span>}
        {it.addedByHim && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">Added by you</span>}
        {it.steps.length > 0 && <span className="rounded-full bg-muted px-2 py-0.5 tabular-nums text-muted-foreground">{stepsDone}/{it.steps.length} checks</span>}
        {it.done && it.doneAt && <span className={cn("rounded-full px-2 py-0.5", late ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400")}>Done {at(it.doneAt)}</span>}
      </div>
      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {it.steps.length > 0 && (
            <ul className="space-y-1">
              {it.steps.map((s) => (
                <li key={s._id}>
                  <button type="button" aria-pressed={s.done} onClick={() => onStep(s._id, !s.done)}
                    className="flex w-full items-start gap-2.5 rounded-lg px-1.5 py-1.5 text-left text-sm hover:bg-muted/60">
                    <span className={cn("mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border-2", s.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40")}>
                      {s.done && <Check className="h-3 w-3" />}
                    </span>
                    <span className={cn("min-w-0 flex-1", s.done && "text-muted-foreground line-through")}>{s.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!it.fixedAt && (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" disabled={!canUp} onClick={() => onMove(-1)}>↑ Earlier</Button>
              <Button size="sm" variant="outline" disabled={!canDown} onClick={() => onMove(1)}>↓ Later</Button>
              <Button size="sm" variant="outline" disabled={it.mins <= 5} onClick={() => onLength(it.mins - 5)}>−5 min</Button>
              <Button size="sm" variant="outline" onClick={() => onLength(it.mins + 5)}>+5 min</Button>
              {it.addedByHim && <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemove}>Remove</Button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddSheet({ day, after, open, onOpenChange, onAdd }: { day: DayPlanDayView; after: string | null; open: boolean; onOpenChange: (o: boolean) => void; onAdd: (title: string, mins: number) => void }) {
  const [title, setTitle] = useState("");
  const [mins, setMins] = useState(15);
  useEffect(() => { if (open) { setTitle(""); setMins(15); } }, [open]);
  const prev = day.items.find((x) => x._id === after);
  const submit = () => { if (!title.trim()) return; onAdd(title.trim(), mins); onOpenChange(false); };
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Add a task</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">
            {prev ? <>After {prev.title}, at {clock(prev.end)}. Everything after it moves {mins} min later.</> : <>At the end of the day.</>}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-4 px-4 pb-2 sm:px-0">
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map(([t, m]) => <button key={t} type="button" onClick={() => { setTitle(t); setMins(m); }} className="rounded-full border border-border bg-muted/60 px-3 py-1 text-xs hover:bg-muted">{t}</button>)}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="day-add-title">Task</Label>
            <Input id="day-add-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Clean the meeting room after the 11 am meeting" autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }} />
          </div>
          <div className="space-y-1.5">
            <Label>How long</Label>
            <div className="flex flex-wrap gap-1.5">
              {DURS.map((d) => (
                <button key={d} type="button" aria-pressed={mins === d} onClick={() => setMins(d)}
                  className={cn("rounded-lg border px-3 py-1.5 text-sm", mins === d ? "border-primary bg-primary font-medium text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted")}>
                  {d < 60 ? `${d} min` : "1 hour"}
                </button>
              ))}
            </div>
          </div>
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!title.trim()}>Add</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
