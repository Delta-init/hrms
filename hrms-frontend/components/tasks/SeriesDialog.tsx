"use client";
import { useEffect, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogFooter,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTaskCategories, useUpdateTaskSeries } from "@/hooks/useTasks";
import { TASK_PRIORITY_LABELS, type TaskPriority, type TaskSeries } from "@/types";
import { RepeatFields, repeatPayload, type RepeatValue } from "./RepeatFields";

const NONE = "__none__";

/**
 * Edit a repeating task (Part 2). Changes apply to the copies still to be made, and to today's if nobody has
 * started them; who it's for stays as it was set.
 */
export function SeriesDialog({ series, onOpenChange }: { series: TaskSeries | null; onOpenChange: (open: boolean) => void }) {
  const { data: categories = [] } = useTaskCategories(!!series);
  const { mutate: save, isPending } = useUpdateTaskSeries();
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [category, setCategory] = useState(NONE);
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [steps, setSteps] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [time, setTime] = useState("18:00");
  const [needsApproval, setNeedsApproval] = useState(true);
  const [proofRequired, setProofRequired] = useState(false);
  const [repeat, setRepeat] = useState<RepeatValue | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!series) return;
    setTitle(series.title); setDetails(series.details ?? ""); setCategory(series.category?._id ?? NONE); setPriority(series.priority);
    setSteps(series.steps ?? []); setDraft(""); setTime(series.dueTime); setNeedsApproval(series.needsApproval); setProofRequired(series.proofRequired);
    setRepeat({
      kind: series.repeat.kind, weekdays: series.repeat.weekdays?.length ? series.repeat.weekdays : [0], everyDays: series.repeat.everyDays ?? 3,
      ends: { kind: series.ends.kind, count: series.ends.count ?? Math.max(10, series.made), date: series.ends.date ?? "" },
    });
    setError("");
  }, [series]);

  if (!series || !repeat) return null;

  const submit = () => {
    if (title.trim().length < 2) { setError("Give the task a title"); return; }
    if (repeat.ends.kind === "date" && !repeat.ends.date) { setError("Pick the last date"); return; }
    save({
      id: series._id,
      data: {
        title: title.trim(), details: details.trim(), category: category === NONE ? null : category, priority, steps,
        dueTime: time, needsApproval, proofRequired, repeat: repeatPayload(repeat) as never,
      },
    }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveDialog open={!!series} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-xl max-h-[90vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Edit repeating task</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">Applies from now on, and to today&apos;s copies nobody has started. {series.made} made so far.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-4 px-4 pb-2 sm:px-0">
          <div className="space-y-1.5"><Label htmlFor="s-title">Task *</Label><Input id="s-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} /></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No category</SelectItem>
                  {categories.map((c) => <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(TASK_PRIORITY_LABELS) as TaskPriority[]).map((k) => <SelectItem key={k} value={k}>{TASK_PRIORITY_LABELS[k]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="s-time">Due by</Label><Input id="s-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
          </div>
          <RepeatFields value={repeat} onChange={setRepeat} startDate={series.startDate} dueTime={time} allowOnce={false} made={series.made} />
          <div className="space-y-1.5"><Label htmlFor="s-details">Details</Label><Textarea id="s-details" rows={2} value={details} onChange={(e) => setDetails(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>Steps</Label>
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-sm">
                <span className="min-w-0 flex-1 break-words">{s}</span>
                <button type="button" aria-label="Remove step" className="rounded p-0.5 text-muted-foreground hover:bg-muted" onClick={() => setSteps((xs) => xs.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a step" aria-label="New step" maxLength={200}
                onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { e.preventDefault(); setSteps((xs) => [...xs, draft.trim()]); setDraft(""); } }} />
              <Button type="button" variant="outline" disabled={!draft.trim()} onClick={() => { setSteps((xs) => [...xs, draft.trim()]); setDraft(""); }}><Plus className="h-4 w-4" />Add</Button>
            </div>
          </div>
          <div className="space-y-3 rounded-xl border border-border p-3">
            <label className="flex items-start justify-between gap-3"><span className="text-sm font-medium">Needs approval</span><Switch checked={needsApproval} onCheckedChange={setNeedsApproval} aria-label="Needs approval" /></label>
            <label className="flex items-start justify-between gap-3"><span className="text-sm font-medium">Proof required</span><Switch checked={proofRequired} onCheckedChange={setProofRequired} aria-label="Proof required" /></label>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={isPending}>{isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save changes</Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
