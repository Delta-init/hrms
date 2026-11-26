"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Clock, Loader2, Lock, Plus } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter, ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toMin } from "@/lib/dayPlan";
import { useDayAction, useHrDayAction } from "@/hooks/useDayPlans";
import type { DayPlanDayView, DayPlanItem } from "@/types";

/** "13:05" → "1:05 pm". */
export const clock = (hhmm: string) => { const m = toMin(hhmm); const h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
const short = (hhmm: string) => clock(hhmm).replace(/ (am|pm)$/, "");
const at = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }) : "");
const nowHHMM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

const DURS = [10, 15, 20, 30, 45, 60];
const QUICK: Array<[string, number]> = [["Clean meeting room after a meeting", 15], ["Urgent cleaning", 15], ["Restock tissues", 10], ["Tea for guests", 10]];

/**
 * A day by the clock (2026-11-26, version 2: built for a phone). What's being done now sits at the top with big
 * ticks; what's done folds away; the rest is a compact list. One Add button asks where; Edit shows the move and
 * length controls. Adding moves everything after it later, up to the next fixed time.
 *
 * `mode="hr"` is the HR department's live view of someone's today: the same day, with add / move / resize / remove,
 * but no ticks — only the person ticks, so a done time is always theirs.
 */
export function MyDayPlan({ day, mode = "mine" }: { day: DayPlanDayView; mode?: "mine" | "hr" }) {
  const hr = mode === "hr";
  const mine = useDayAction();
  const theirs = useHrDayAction();
  const { mutate, isPending, variables } = hr ? theirs : mine;
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ after: string | null } | null>(null);
  const [editing, setEditing] = useState(hr);
  const [showDone, setShowDone] = useState(false);
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
  const busy = (url: string) => isPending && variables?.url === `${day._id}/${url}`;
  const reorder = (ids: string[], message: string) => act("put", "order", { ids }, message);
  const move = (i: number, dir: -1 | 1) => {
    const ids = day.items.map((x) => x._id); const j = i + dir;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder(ids, `Moved "${day.items[i].title}" ${dir < 0 ? "earlier" : "later"}`);
  };
  const canSwap = (i: number, dir: -1 | 1) => { const j = i + dir; return j >= 0 && j < day.items.length && !day.items[j].fixedAt && !day.items[i].fixedAt; };

  const current = useMemo(() => day.items.find((i) => !i.done && i.kind !== "break") ?? null, [day.items]);
  const doneItems = day.items.filter((i) => i.done);
  const later = day.items.filter((i) => !i.done && i._id !== current?._id);
  const last = day.items[day.items.length - 1];
  const behind = current ? toMin(now) - toMin(current.end) : 0;
  const nextRound = day.rounds.find((r) => !r.doneAt);
  const roundDue = !hr && !!nextRound && toMin(now) >= toMin(nextRound.due) - 10;
  const pct = day.progress.total ? Math.round((day.progress.done / day.progress.total) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-xl">
      {/* Stays in view while scrolling: progress, finish time, the next round, Edit. */}
      <div className="sticky top-0 z-10 -mx-1 space-y-2 border-b border-border bg-background/95 px-1 pb-2.5 pt-1 backdrop-blur">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="truncate text-base font-semibold">{hr ? "Today" : day.planName ?? "Today"}</h2>
          <span className="shrink-0 text-xs text-muted-foreground">
            {day.progress.done} of {day.progress.total} done ·{" "}
            {last?.over ? <span className="font-medium text-red-600 dark:text-red-400">runs {last.over} min late</span> : <>ends {clock(day.endsAt)}</>}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500 transition-[width]" style={{ width: `${pct}%` }} /></div>
        <div className="flex items-center gap-2 text-xs">
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-primary">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{nextRound ? (roundDue ? "Office round due now" : `Round at ${clock(nextRound.due)}`) : day.rounds.length ? "All rounds done" : "No rounds"}</span>
          </span>
          {!hr && nextRound && (
            <Button size="sm" className="h-8 rounded-full px-3" disabled={!roundDue || busy("rounds")} onClick={() => act("post", "rounds", { due: nextRound.due }, `Round at ${clock(nextRound.due)} recorded`)}>Round done</Button>
          )}
          <Button size="sm" variant={editing ? "default" : "outline"} className="h-8 rounded-full px-3" onClick={() => setEditing((e) => !e)}>{editing ? "Done editing" : "Edit"}</Button>
        </div>
      </div>

      <div className="space-y-3 pb-20 pt-3 md:pb-4">
        {doneItems.length > 0 && (
          <div>
            <button type="button" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}
              className="flex w-full items-center justify-between rounded-xl border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><Check className="h-4 w-4 text-emerald-500" />{doneItems.length} done</span>
              <span className="flex items-center gap-0.5 text-xs">{showDone ? "Hide" : "Show"}{showDone ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</span>
            </button>
            {showDone && <List items={doneItems} />}
          </div>
        )}

        {/* What's being done now: big ticks, a button to finish it. */}
        {current && (
          <div className="rounded-2xl border-2 border-primary bg-card p-3.5 shadow-sm">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-primary">
              Now
              <span className="ml-auto font-medium normal-case tracking-normal text-muted-foreground tabular-nums">
                {short(current.start)}–{clock(current.end)} · {current.mins} min
                {behind > 0 && <span className="font-semibold text-red-600 dark:text-red-400"> · {behind} min behind</span>}
              </span>
            </div>
            <h3 className="mt-1 text-lg font-semibold leading-snug">{current.title}</h3>
            {(current.addedByHim || current.addedByHr) && <p className="text-xs text-primary">{current.addedByHr ? "Added by HR" : hr ? "Added by them" : "Added by you"}</p>}
            {current.steps.length > 0 && <Checks item={current} canTick={!hr} onStep={(id, d) => act("patch", `items/${current._id}/steps/${id}`, { done: d })} />}
            {!hr ? (
              <Button className="mt-2 h-11 w-full text-[15px]" disabled={busy(`items/${current._id}`)} onClick={() => act("patch", `items/${current._id}`, { done: true }, `${current.title} done`)}>
                {busy(`items/${current._id}`) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {current.steps.length && current.steps.some((s) => !s.done) ? `Mark all done (${current.steps.filter((s) => s.done).length}/${current.steps.length})` : "Done"}
              </Button>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">{current.steps.filter((s) => s.done).length} of {current.steps.length} checks ticked. Only they can tick.</p>
            )}
            {editing && <div className="mt-2"><RowTools item={current} index={day.items.indexOf(current)} hr={hr} canSwap={canSwap} move={move} act={act} onAdd={() => setAdding({ after: current._id })} /></div>}
          </div>
        )}

        {later.length > 0 && (
          <div>
            <p className="mb-1.5 flex justify-between px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              <span>Later today</span><span className="tabular-nums">{later.filter((i) => i.kind !== "break").length}</span>
            </p>
            <List items={later} />
          </div>
        )}

        {!current && !later.length && <p className="py-6 text-center text-sm text-muted-foreground">Everything&apos;s done for today.</p>}
        {!hr && <p className="text-center text-xs text-muted-foreground">Changes you make are for today. Tomorrow starts from HR&apos;s plan.</p>}
      </div>

      {/* Where the thumb is on a phone — just above the app's bottom tab bar (10px up, 64px tall, phones only); in the flow on a computer. */}
      <Button onClick={() => setAdding({ after: current?._id ?? null })}
        className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+86px)] right-4 z-30 h-12 rounded-full px-5 shadow-lg md:static md:h-10 md:w-full md:rounded-md md:shadow-none">
        <Plus className="h-4 w-4" />Add task
      </Button>

      <AddSheet day={day} after={adding?.after ?? null} open={!!adding} hr={hr} onOpenChange={(o) => !o && setAdding(null)}
        onAdd={(title, mins, afterId) => act("post", "items", { title, mins, afterId }, `Added "${title}"`)} />
    </div>
  );

  function List({ items }: { items: DayPlanItem[] }) {
    return (
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {items.map((it) => {
          const i = day.items.indexOf(it);
          const brk = it.kind === "break";
          const fixedOnly = !!it.fixedAt && brk;
          const stepsDone = it.steps.filter((s) => s.done).length;
          const late = it.done && it.doneAt ? (() => { const d = new Date(it.doneAt); return d.getHours() * 60 + d.getMinutes() > toMin(it.end) + 10; })() : false;
          return (
            <div key={it._id} className="border-t border-border first:border-t-0">
              {it.free > 0 && <p className="border-b border-border px-3 py-1 pl-[68px] text-[11.5px] text-muted-foreground">{it.free} min free</p>}
              {it.over > 0 && <p className="border-b border-border px-3 py-1 pl-[68px] text-[11.5px] text-red-600 dark:text-red-400">Running {it.over} min into {brk ? "lunch" : it.title.toLowerCase()}</p>}
              <div className={cn("relative grid grid-cols-[52px_1fr_auto] items-center gap-2 px-3 transition-colors",
                fixedOnly ? "min-h-[38px] bg-muted/40" : "min-h-[52px] py-1.5", moved[it._id] && "bg-amber-100 dark:bg-amber-900/30",
                (it.addedByHim || it.addedByHr) && "before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded before:bg-primary")}>
                <div className="tabular-nums">
                  <p className={cn("text-[13px] font-semibold", fixedOnly && "text-muted-foreground")}>{short(it.start)}</p>
                  {moved[it._id] && <p className="text-[10px] leading-tight text-amber-700 dark:text-amber-400">was {short(moved[it._id])}</p>}
                </div>
                <button type="button" onClick={() => it.steps.length && setOpen(open === it._id ? null : it._id)} aria-expanded={open === it._id} className="min-w-0 text-left">
                  <p className={cn("flex items-center gap-1 truncate font-medium", fixedOnly ? "text-[13px] text-muted-foreground" : "text-sm", it.done && "text-muted-foreground line-through")}>
                    {it.fixedAt && <Lock className="h-3 w-3 shrink-0 opacity-60" />}<span className="truncate">{it.title}</span>
                  </p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {it.mins} min
                    {it.steps.length > 0 && ` · ${stepsDone}/${it.steps.length} checks`}
                    {it.addedByHr ? " · added by HR" : it.addedByHim ? (hr ? " · added by them" : " · added by you") : ""}
                    {it.done && it.doneAt && <span className={late ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}> · done {at(it.doneAt)}</span>}
                  </p>
                </button>
                {editing && !it.done ? <RowTools item={it} index={i} hr={hr} canSwap={canSwap} move={move} act={act} compact />
                  : !brk && !hr ? (
                    <button type="button" aria-pressed={it.done} aria-label={`Mark ${it.title} ${it.done ? "not done" : "done"}`} disabled={busy(`items/${it._id}`)}
                      onClick={() => act("patch", `items/${it._id}`, { done: !it.done })}
                      className={cn("flex h-9 w-9 items-center justify-center rounded-xl border-2 transition-colors", it.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/30 hover:border-emerald-500")}>
                      {busy(`items/${it._id}`) ? <Loader2 className="h-4 w-4 animate-spin" /> : it.done ? <Check className="h-4 w-4" /> : null}
                    </button>
                  ) : <span />}
              </div>
              {open === it._id && it.steps.length > 0 && <div className="px-3 pb-2 pl-[60px]"><Checks item={it} canTick={!hr && !it.done} onStep={(id, d) => act("patch", `items/${it._id}/steps/${id}`, { done: d })} /></div>}
              {editing && !it.done && i < day.items.length - 1 && (
                <button type="button" onClick={() => setAdding({ after: it._id })}
                  className="w-full border-t border-dashed border-border py-1.5 pl-[68px] text-left text-xs font-medium text-primary hover:bg-primary/5">+ add here</button>
              )}
            </div>
          );
        })}
      </div>
    );
  }
}

function Checks({ item, canTick, onStep }: { item: DayPlanItem; canTick: boolean; onStep: (stepId: string, done: boolean) => void }) {
  return (
    <ul className="mt-2 space-y-0.5">
      {item.steps.map((s) => (
        <li key={s._id}>
          <button type="button" aria-pressed={s.done} disabled={!canTick} onClick={() => onStep(s._id, !s.done)}
            className="flex min-h-[40px] w-full items-center gap-3 rounded-lg px-1.5 text-left text-sm enabled:hover:bg-muted/60 enabled:active:bg-muted">
            <span className={cn("flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border-2", s.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-muted-foreground/40")}>
              {s.done && <Check className="h-3.5 w-3.5" />}
            </span>
            <span className={cn("min-w-0 flex-1", s.done && "text-muted-foreground line-through")}>{s.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** ↑ ↓ − + and remove — shown in Edit. HR can take any non-fixed task off today; they can only remove what they added. */
function RowTools({ item, index, hr, canSwap, move, act, compact, onAdd }: {
  item: DayPlanItem; index: number; hr: boolean; canSwap: (i: number, d: -1 | 1) => boolean; move: (i: number, d: -1 | 1) => void;
  act: (m: "patch" | "post" | "put" | "delete", url: string, body?: unknown, msg?: string) => void; compact?: boolean; onAdd?: () => void;
}) {
  if (item.fixedAt) return <span className="text-[11px] text-muted-foreground">fixed</span>;
  const canRemove = hr || item.addedByHim;
  const b = "flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-sm disabled:opacity-30";
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <button type="button" className={b} aria-label="Earlier" disabled={!canSwap(index, -1)} onClick={() => move(index, -1)}>↑</button>
      <button type="button" className={b} aria-label="Later" disabled={!canSwap(index, 1)} onClick={() => move(index, 1)}>↓</button>
      <button type="button" className={b} aria-label="5 minutes shorter" disabled={item.mins <= 5} onClick={() => act("patch", `items/${item._id}/length`, { mins: item.mins - 5 }, `"${item.title}" is now ${item.mins - 5} min`)}>−</button>
      <button type="button" className={b} aria-label="5 minutes longer" onClick={() => act("patch", `items/${item._id}/length`, { mins: item.mins + 5 }, `"${item.title}" is now ${item.mins + 5} min`)}>+</button>
      {canRemove && <button type="button" className={cn(b, "w-auto px-2 text-xs text-destructive")} onClick={() => act("delete", `items/${item._id}`, undefined, `Removed "${item.title}"`)}>{compact ? "✕" : "Remove"}</button>}
      {onAdd && !compact && <button type="button" className={cn(b, "w-auto px-2 text-xs text-primary")} onClick={onAdd}>+ add after</button>}
    </div>
  );
}

function AddSheet({ day, after, open, hr, onOpenChange, onAdd }: {
  day: DayPlanDayView; after: string | null; open: boolean; hr: boolean; onOpenChange: (o: boolean) => void; onAdd: (title: string, mins: number, afterId: string | null) => void;
}) {
  const [title, setTitle] = useState("");
  const [mins, setMins] = useState(15);
  const [where, setWhere] = useState("");
  const options = day.items.filter((i, idx) => !i.done && idx < day.items.length - 1);
  useEffect(() => { if (open) { setTitle(""); setMins(15); setWhere(after ?? options[0]?._id ?? ""); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const prev = day.items.find((x) => x._id === where);
  const submit = () => { if (!title.trim()) return; onAdd(title.trim(), mins, where || null); onOpenChange(false); };
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{hr ? "Add to their day" : "Add a task"}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">For today only.{hr ? " They'll get a notice." : ""}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-4 px-4 pb-2 sm:px-0">
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map(([t, m]) => <button key={t} type="button" onClick={() => { setTitle(t); setMins(m); }} className="rounded-full border border-border bg-muted/60 px-3 py-1.5 text-xs hover:bg-muted">{t}</button>)}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="day-add-title">Task</Label>
            <Input id="day-add-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Clean the meeting room after the 11 am meeting"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }} />
          </div>
          <div className="space-y-1.5">
            <Label>Where</Label>
            <Select value={where} onValueChange={setWhere}>
              <SelectTrigger><SelectValue placeholder="Choose where" /></SelectTrigger>
              <SelectContent>{options.map((o) => <SelectItem key={o._id} value={o._id}>After {o.title} ({short(o.end)})</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>How long</Label>
            <div className="flex flex-wrap gap-1.5">
              {DURS.map((d) => (
                <button key={d} type="button" aria-pressed={mins === d} onClick={() => setMins(d)}
                  className={cn("min-h-[36px] rounded-lg border px-3 text-sm", mins === d ? "border-primary bg-primary font-medium text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted")}>
                  {d < 60 ? `${d} min` : "1 hour"}
                </button>
              ))}
            </div>
          </div>
          {prev && <p className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary">Starts {clock(prev.end)}. Everything after it moves {mins} min later, up to the next fixed time.</p>}
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!title.trim()}>Add</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
