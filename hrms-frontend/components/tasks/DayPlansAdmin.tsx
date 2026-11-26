"use client";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronDown, ChevronUp, Coffee, FileText, Loader2, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter, ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { EmployeeSelect } from "@/components/pickers";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useDayPlans, useSaveDayPlan, usePlanDay } from "@/hooks/useDayPlans";
import { schedule, toHHMM, toMin } from "@/lib/dayPlan";
import { OFFICE_BOY_ROUTINE } from "@/lib/dayPlanPresets";
import { clock } from "./MyDayPlan";
import type { DayPlanRoutine, DayPlanRoutineItem } from "@/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const daysText = (w: number[]) => (w.length === 7 ? "Every day" : w.length === 6 && !w.includes(6) ? "Mon–Sat" : w.length === 5 && w.every((d) => d < 5) ? "Mon–Fri" : [...w].sort().map((d) => DAYS[d]).join(", "));

/** HR's Day plans tab (2026-11-26): each person's routine, and how any day of it went. */
export function DayPlansAdmin() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("tasks", "create");
  const canEdit = hasPermission("tasks", "edit");
  const { data: plans = [], isLoading } = useDayPlans();
  const [editing, setEditing] = useState<{ open: boolean; plan: DayPlanRoutine | null }>({ open: false, plan: null });
  const [viewing, setViewing] = useState<string | null>(null);
  useEffect(() => { if (!viewing && plans.length) setViewing(plans[0]._id); }, [plans, viewing]);

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">A working day by the clock, for someone whose day is a round of areas, like the office boy. They tick each area and its checks, and can add or move tasks for that day.</p>
        {canCreate && <Button onClick={() => setEditing({ open: true, plan: null })}><Plus className="h-4 w-4" />New day plan</Button>}
      </div>

      {!plans.length ? (
        <Card className="py-14 text-center">
          <CalendarClock className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
          <p className="font-medium">No day plans yet</p>
          <p className="text-sm text-muted-foreground">Start one from the Office Boy job description and adjust the times.</p>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((p) => {
            const slots = schedule(p.startAt, p.items);
            const end = slots.length ? toHHMM(slots[slots.length - 1].end) : p.startAt;
            return (
              <Card key={p._id} className={cn("flex flex-col gap-2 p-4 transition-colors", viewing === p._id && "border-primary/50")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-sm text-muted-foreground">{p.employee?.name ?? "—"}</p>
                  </div>
                  <span className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium", p.active ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "border-border bg-muted text-muted-foreground")}>{p.active ? "On" : "Off"}</span>
                </div>
                <p className="text-xs text-muted-foreground">{daysText(p.weekdays)} · {clock(p.startAt)} to {clock(end)} · {p.items.filter((i) => i.kind !== "break").length} tasks{p.roundEveryMins ? ` · rounds every ${p.roundEveryMins} min` : ""}</p>
                <div className="mt-auto flex gap-1.5 border-t border-border pt-2">
                  <Button size="sm" variant={viewing === p._id ? "secondary" : "ghost"} onClick={() => setViewing(p._id)}>See the day</Button>
                  {canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing({ open: true, plan: p })}><Pencil className="h-3.5 w-3.5" />Edit</Button>}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {viewing && <DayView planId={viewing} name={plans.find((p) => p._id === viewing)?.name ?? ""} />}
      <RoutineDialog open={editing.open} plan={editing.plan} onOpenChange={(o) => setEditing((e) => ({ ...e, open: o }))} />
    </div>
  );
}

// ── How a day went ───────────────────────────────────────────────────────────

function DayView({ planId, name }: { planId: string; name: string }) {
  const [date, setDate] = useState("");
  const { data, isLoading } = usePlanDay(planId, date || undefined);
  const day = data?.day;
  const at = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }) : "");
  const late = (doneAt: string | null | undefined, end: string) => { if (!doneAt) return false; const d = new Date(doneAt); return d.getHours() * 60 + d.getMinutes() > toMin(end) + 10; };
  const work = day?.items.filter((i) => i.kind !== "break") ?? [];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div><p className="font-medium">{name}</p><p className="text-xs text-muted-foreground">{data?.date ? new Date(`${data.date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" }) : ""}</p></div>
        <Input type="date" value={date || data?.date || ""} onChange={(e) => setDate(e.target.value)} className="h-9 w-auto" aria-label="Day to show" />
      </div>
      {isLoading ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        : !day ? <p className="p-8 text-center text-sm text-muted-foreground">Nothing for this day. Either it isn&apos;t a working day on this plan, or the plan wasn&apos;t opened.</p>
        : (
          <>
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
              <Stat label="Done" value={`${day.progress.done} / ${day.progress.total}`} />
              <Stat label="Done late" value={work.filter((i) => late(i.doneAt, i.end)).length} tone="warn" />
              <Stat label="Added by them" value={day.items.filter((i) => i.addedByHim).length} tone="accent" />
              <Stat label="Rounds done" value={`${day.rounds.filter((r) => r.doneAt).length} / ${day.rounds.length}`} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr className="border-y border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Time</th><th className="px-4 py-2.5 font-medium">Task</th><th className="px-4 py-2.5 font-medium">Checks</th><th className="px-4 py-2.5 font-medium">Done at</th><th className="px-4 py-2.5 font-medium">Note</th>
                </tr></thead>
                <tbody>
                  {day.items.map((it) => (
                    <tr key={it._id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2.5 tabular-nums">{clock(it.start)}{it.plannedAt && it.plannedAt !== it.start && <span className="ml-1.5 text-xs text-muted-foreground line-through">{clock(it.plannedAt)}</span>}</td>
                      <td className="px-4 py-2.5">{it.kind === "break" ? <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Coffee className="h-3.5 w-3.5" />{it.title}</span> : it.title}</td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{it.steps.length ? `${it.steps.filter((s) => s.done).length}/${it.steps.length}` : "—"}</td>
                      <td className="px-4 py-2.5 tabular-nums">{it.kind === "break" ? "" : it.done ? at(it.doneAt) : <span className="text-muted-foreground">Not yet</span>}</td>
                      <td className="px-4 py-2.5">
                        <span className="flex flex-wrap gap-1.5 text-xs">
                          {it.addedByHim && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">Added by them</span>}
                          {it.plannedAt && it.plannedAt !== it.start && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-400">Moved {Math.abs(toMin(it.start) - toMin(it.plannedAt))} min {toMin(it.start) > toMin(it.plannedAt) ? "later" : "earlier"}</span>}
                          {late(it.doneAt, it.end) && <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-red-600 dark:text-red-400">Late</span>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "warn" | "accent" }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className={cn("text-xl font-semibold tabular-nums", tone === "warn" && value ? "text-amber-600 dark:text-amber-400" : tone === "accent" && value ? "text-primary" : "")}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

// ── The routine editor ───────────────────────────────────────────────────────

type Row = DayPlanRoutineItem & { key: string; stepsText: string };
let keySeq = 0;
const toRow = (i: DayPlanRoutineItem): Row => ({ ...i, key: `r${++keySeq}`, stepsText: (i.steps ?? []).join("\n") });

function RoutineDialog({ open, plan, onOpenChange }: { open: boolean; plan: DayPlanRoutine | null; onOpenChange: (o: boolean) => void }) {
  const { mutate: save, isPending } = useSaveDayPlan();
  const [name, setName] = useState("");
  const [employee, setEmployee] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([0, 1, 2, 3, 4, 5]);
  const [startAt, setStartAt] = useState("09:00");
  const [rounds, setRounds] = useState(60);
  const [active, setActive] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError(""); setOpenRow(null);
    if (plan) {
      setName(plan.name); setEmployee(plan.employee?._id ?? ""); setEmployeeName(plan.employee?.name ?? ""); setWeekdays(plan.weekdays);
      setStartAt(plan.startAt); setRounds(plan.roundEveryMins); setActive(plan.active); setRows(plan.items.map(toRow));
    } else {
      setName("Office boy's day"); setEmployee(""); setEmployeeName(""); setWeekdays([0, 1, 2, 3, 4, 5]); setStartAt("09:00"); setRounds(60); setActive(true); setRows([]);
    }
  }, [open, plan]);

  const slots = useMemo(() => schedule(startAt, rows), [startAt, rows]);
  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => setRows((rs) => { const j = i + d; if (j < 0 || j >= rs.length) return rs; const o = [...rs]; [o[i], o[j]] = [o[j], o[i]]; return o; });

  const submit = () => {
    if (name.trim().length < 2) { setError("Name the plan"); return; }
    if (!employee) { setError("Choose who it's for"); return; }
    if (!rows.length) { setError("Add at least one task"); return; }
    if (rows.some((r) => !r.title.trim())) { setError("Every task needs a name"); return; }
    const fixed = rows.filter((r) => r.fixedAt).map((r) => toMin(r.fixedAt!));
    if (fixed.some((t, i) => i > 0 && t <= fixed[i - 1])) { setError("Fixed times must be in order through the day"); return; }
    save({
      id: plan?._id,
      data: {
        name: name.trim(), employee, weekdays, startAt, roundEveryMins: rounds, active,
        items: rows.map((r) => ({ title: r.title.trim(), mins: r.mins, kind: r.kind, fixedAt: r.fixedAt || null, steps: r.stepsText.split("\n").map((s) => s.trim()).filter(Boolean) })),
      },
    }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-3xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{plan ? "Edit day plan" : "New day plan"}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">Changes apply from the next day it&apos;s opened. A day already started keeps what it was given.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-4 px-4 pb-2 sm:px-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="dp-name">Name</Label><Input id="dp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></div>
            <div className="space-y-1.5"><Label>For</Label>
              <EmployeeSelect value={employee} selectedLabel={employeeName} placeholder="Choose a person" onChange={setEmployee} onPick={(o) => setEmployeeName(o?.label ?? "")} />
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5"><Label>Days</Label>
              <div className="flex flex-wrap gap-1">
                {DAYS.map((d, i) => {
                  const on = weekdays.includes(i);
                  return <button key={d} type="button" aria-pressed={on} onClick={() => { const n = on ? weekdays.filter((x) => x !== i) : [...weekdays, i].sort(); if (n.length) setWeekdays(n); }}
                    className={cn("h-9 w-11 rounded-lg border text-xs font-medium", on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted")}>{d.slice(0, 2)}</button>;
                })}
              </div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="dp-start">Day starts</Label><Input id="dp-start" type="time" value={startAt} onChange={(e) => setStartAt(e.target.value)} className="h-9 w-32" /></div>
            <div className="space-y-1.5"><Label htmlFor="dp-rounds">Rounds every</Label>
              <div className="flex items-center gap-2 text-sm"><Input id="dp-rounds" type="number" min={0} max={240} step={15} value={rounds} onChange={(e) => setRounds(Math.max(0, Math.min(240, Number(e.target.value) || 0)))} className="h-9 w-20" /><span className="text-muted-foreground">min (0 = none)</span></div>
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm"><Switch checked={active} onCheckedChange={setActive} aria-label="Plan is on" />On</label>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Tasks, in order</Label>
              <div className="flex flex-wrap gap-1.5">
                <Button type="button" size="sm" variant="outline" onClick={() => { setRows(OFFICE_BOY_ROUTINE.map(toRow)); setStartAt("09:00"); }}><FileText className="h-3.5 w-3.5" />{rows.length ? "Replace with" : "Start from"} Office Boy job description</Button>
              </div>
            </div>
            {rows.length > 0 && slots.length > 0 && (
              <p className="text-xs text-muted-foreground">Runs {clock(startAt)} to {clock(toHHMM(slots[slots.length - 1].end))}{slots.some((s) => s.over) ? ". Some tasks run into a fixed time; shorten them or move the fixed time." : "."}</p>
            )}
            <ol className="space-y-1.5">
              {rows.map((r, i) => {
                const s = slots[i];
                return (
                  <li key={r.key} className={cn("rounded-xl border border-border", r.fixedAt && "border-dashed bg-muted/30")}>
                    {s?.over > 0 && <p className="px-3 pt-2 text-xs text-red-600 dark:text-red-400">Tasks before this run {s.over} min past {clock(r.fixedAt!)}</p>}
                    <div className="flex flex-wrap items-center gap-2 p-2">
                      <span className="w-16 text-right text-xs font-medium tabular-nums">{s ? clock(toHHMM(s.start)) : ""}</span>
                      <Input value={r.title} onChange={(e) => set(r.key, { title: e.target.value })} className="h-8 min-w-[140px] flex-1" aria-label="Task name" maxLength={120} />
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Input type="number" min={5} max={480} step={5} value={r.mins} onChange={(e) => set(r.key, { mins: Math.max(5, Math.min(480, Number(e.target.value) || 5)) })} className="h-8 w-16" aria-label="Minutes" />min
                      </div>
                      <button type="button" onClick={() => setOpenRow(openRow === r.key ? null : r.key)} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
                        {r.stepsText.split("\n").filter((x) => x.trim()).length} checks
                      </button>
                      <span className="flex items-center">
                        <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button>
                        <button type="button" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button>
                        <button type="button" aria-label="Remove task" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="rounded p-1 text-muted-foreground hover:bg-muted"><Trash2 className="h-4 w-4" /></button>
                      </span>
                    </div>
                    {openRow === r.key && (
                      <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-[1fr_200px]">
                        <div className="space-y-1.5"><Label htmlFor={`steps-${r.key}`}>Checks, one per line</Label>
                          <Textarea id={`steps-${r.key}`} rows={5} value={r.stepsText} onChange={(e) => set(r.key, { stepsText: e.target.value })} />
                        </div>
                        <div className="space-y-3">
                          <div className="space-y-1.5"><Label htmlFor={`fixed-${r.key}`} className="flex items-center gap-1"><Lock className="h-3 w-3" />Fixed time</Label>
                            <Input id={`fixed-${r.key}`} type="time" value={r.fixedAt ?? ""} onChange={(e) => set(r.key, { fixedAt: e.target.value || null })} className="h-8" />
                            <p className="text-[11px] text-muted-foreground">Leave empty to follow the task before it.</p>
                          </div>
                          <label className="flex items-center gap-2 text-sm"><Switch checked={r.kind === "break"} onCheckedChange={(b) => set(r.key, { kind: b ? "break" : "task" })} aria-label="Break" />A break (no tick)</label>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            <Button type="button" variant="outline" size="sm" onClick={() => { const r = toRow({ title: "", mins: 15, steps: [], kind: "task", fixedAt: null }); setRows((rs) => [...rs, r]); setOpenRow(r.key); }}><Plus className="h-3.5 w-3.5" />Add a task</Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{plan ? "Save" : "Create day plan"}</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
