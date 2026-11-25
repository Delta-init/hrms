"use client";
import { useEffect, useMemo, useState } from "react";
import { Building2, GripVertical, Loader2, Plus, X } from "lucide-react";
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
import { EmployeeSelect, DepartmentSelect } from "@/components/pickers";
import { useCreateTask, useUpdateTask, useTaskCategories, useCreateTaskCategory } from "@/hooks/useTasks";
import { TASK_PRIORITY_LABELS, type Task, type TaskPriority } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing one person's copy; null for a new task. */
  task?: Task | null;
}

const NEW_CATEGORY = "__new__";
const NONE = "__none__";

/** Tomorrow at 6 pm, local — a sensible default deadline. */
function defaultDue() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return { date: d.toLocaleDateString("en-CA"), time: "18:00" };
}

/**
 * Assign a task, or change one person's copy (2026-11-25). People and departments are added as chips; a department
 * becomes one copy per person in it when saved. Steps become the checklist the employee ticks.
 */
export function TaskDialog({ open, onOpenChange, task = null }: Props) {
  const editing = !!task;
  const { mutate: create, isPending: creating } = useCreateTask();
  const { mutate: update, isPending: updating } = useUpdateTask();
  const { data: categories = [] } = useTaskCategories(open);
  const { mutate: addCategory, isPending: addingCategory } = useCreateTaskCategory();

  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [category, setCategory] = useState(NONE);
  const [newCategory, setNewCategory] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);
  const [depts, setDepts] = useState<Array<{ id: string; name: string }>>([]);
  const [pickPerson, setPickPerson] = useState("");
  const [pickDept, setPickDept] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("18:00");
  const [steps, setSteps] = useState<string[]>([]);
  const [stepDraft, setStepDraft] = useState("");
  const [needsApproval, setNeedsApproval] = useState(true);
  const [proofRequired, setProofRequired] = useState(false);
  const [error, setError] = useState("");

  const stepsLocked = editing && (task?.steps ?? []).some((s) => s.done);

  useEffect(() => {
    if (!open) return;
    setError(""); setNewCategory(""); setPickPerson(""); setPickDept(""); setStepDraft("");
    if (task) {
      const due = new Date(task.dueAt);
      setTitle(task.title); setDetails(task.details ?? ""); setCategory(task.category?._id ?? NONE);
      setPriority(task.priority); setPeople([]); setDepts([]);
      setDate(due.toLocaleDateString("en-CA")); setTime(due.toTimeString().slice(0, 5));
      setSteps(task.steps.map((s) => s.title)); setNeedsApproval(task.needsApproval); setProofRequired(task.proofRequired);
    } else {
      const d = defaultDue();
      setTitle(""); setDetails(""); setCategory(NONE); setPriority("normal"); setPeople([]); setDepts([]);
      setDate(d.date); setTime(d.time); setSteps([]); setNeedsApproval(true); setProofRequired(false);
    }
  }, [open, task]);

  const addStep = () => {
    const s = stepDraft.trim();
    if (!s) return;
    setSteps((xs) => [...xs, s]);
    setStepDraft("");
  };
  const moveStep = (i: number, dir: -1 | 1) => setSteps((xs) => {
    const j = i + dir;
    if (j < 0 || j >= xs.length) return xs;
    const out = [...xs];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  });

  const dueLabel = useMemo(() => {
    if (!date) return "";
    const d = new Date(`${date}T${time || "18:00"}`);
    return isNaN(d.getTime()) ? "" : d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  }, [date, time]);

  const submit = () => {
    if (title.trim().length < 2) { setError("Give the task a title"); return; }
    if (!editing && !people.length && !depts.length) { setError("Choose who gets it"); return; }
    if (!date) { setError("Choose when it's due"); return; }
    const dueAt = new Date(`${date}T${time || "18:00"}`).toISOString();
    const base = {
      title: title.trim(), details: details.trim(), category: category === NONE ? null : category, priority,
      dueAt, needsApproval, proofRequired,
    };
    if (editing) {
      update({ id: task!._id, data: { ...base, ...(stepsLocked ? {} : { steps }) } }, { onSuccess: () => onOpenChange(false) });
    } else {
      create({ ...base, employees: people.map((p) => p.id), departments: depts.map((d) => d.id), steps }, { onSuccess: () => onOpenChange(false) });
    }
  };

  const pending = creating || updating;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-xl max-h-[90vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{editing ? "Edit task" : "New task"}</ResponsiveDialogTitle>
          {editing && <ResponsiveDialogDescription className="px-4 pt-1 sm:px-0">{task!.assignee?.name}&apos;s copy. Other people&apos;s copies don&apos;t change.</ResponsiveDialogDescription>}
        </ResponsiveDialogHeader>

        <div className="space-y-4 px-4 pb-2 sm:px-0">
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Task *</Label>
            <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Update CRM follow-ups" maxLength={150} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No category</SelectItem>
                  {categories.map((c) => <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>)}
                  <SelectItem value={NEW_CATEGORY}>+ New category…</SelectItem>
                </SelectContent>
              </Select>
              {category === NEW_CATEGORY && (
                <div className="flex gap-2">
                  <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Sales" maxLength={40} aria-label="New category name" />
                  <Button type="button" variant="outline" disabled={addingCategory || newCategory.trim().length < 2}
                    onClick={() => addCategory(newCategory.trim(), { onSuccess: (c) => { setCategory(c._id); setNewCategory(""); } })}>
                    {addingCategory ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TASK_PRIORITY_LABELS) as TaskPriority[]).map((k) => <SelectItem key={k} value={k}>{TASK_PRIORITY_LABELS[k]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!editing && (
            <div className="space-y-1.5">
              <Label>Assign to *</Label>
              {(people.length > 0 || depts.length > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {people.map((p) => (
                    <span key={p.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 py-0.5 pl-2.5 pr-1 text-xs">
                      {p.name}
                      <button type="button" aria-label={`Remove ${p.name}`} className="rounded-full p-0.5 hover:bg-background" onClick={() => setPeople((xs) => xs.filter((x) => x.id !== p.id))}><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                  {depts.map((d) => (
                    <span key={d.id} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-0.5 pl-2 pr-1 text-xs text-primary">
                      <Building2 className="h-3 w-3" />{d.name} · everyone
                      <button type="button" aria-label={`Remove ${d.name}`} className="rounded-full p-0.5 hover:bg-background" onClick={() => setDepts((xs) => xs.filter((x) => x.id !== d.id))}><X className="h-3 w-3" /></button>
                    </span>
                  ))}
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <EmployeeSelect
                  value={pickPerson}
                  placeholder="Add a person"
                  decorate={(o) => (people.some((p) => p.id === o.value) ? { ...o, disabled: true, badge: { label: "Added" } } : o)}
                  onChange={() => setPickPerson("")}
                  onPick={(o) => { if (o && !people.some((p) => p.id === o.value)) setPeople((xs) => [...xs, { id: o.value, name: o.label }]); setPickPerson(""); }}
                />
                <DepartmentSelect
                  value={pickDept}
                  placeholder="Add a department"
                  decorate={(o) => (depts.some((d) => d.id === o.value) ? { ...o, disabled: true, badge: { label: "Added" } } : o)}
                  onChange={() => setPickDept("")}
                  onPick={(o) => { if (o && !depts.some((d) => d.id === o.value)) setDepts((xs) => [...xs, { id: o.value, name: o.label }]); setPickDept(""); }}
                />
              </div>
              <p className="text-xs text-muted-foreground">Each person gets their own copy to tick off. A department means everyone in it today.</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="task-date">Due *</Label>
              <Input id="task-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-time">By</Label>
              <Input id="task-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          {dueLabel && <p className="-mt-2 text-xs text-muted-foreground">Due {dueLabel}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="task-details">Details</Label>
            <Textarea id="task-details" rows={2} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Anything they need to know" />
          </div>

          <div className="space-y-1.5">
            <Label>Steps</Label>
            {stepsLocked ? (
              <p className="rounded-lg border border-dashed border-border p-2 text-xs text-muted-foreground">Steps can&apos;t change once one has been ticked.</p>
            ) : (
              <>
                {steps.length > 0 && (
                  <ol className="space-y-1.5">
                    {steps.map((s, i) => (
                      <li key={i} className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-sm">
                        <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 break-words">{s}</span>
                        <button type="button" className="rounded px-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-30" disabled={i === 0} onClick={() => moveStep(i, -1)} aria-label="Move up">↑</button>
                        <button type="button" className="rounded px-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-30" disabled={i === steps.length - 1} onClick={() => moveStep(i, 1)} aria-label="Move down">↓</button>
                        <button type="button" className="rounded p-0.5 text-muted-foreground hover:bg-muted" onClick={() => setSteps((xs) => xs.filter((_, j) => j !== i))} aria-label="Remove step"><X className="h-3.5 w-3.5" /></button>
                      </li>
                    ))}
                  </ol>
                )}
                <div className="flex gap-2">
                  <Input value={stepDraft} onChange={(e) => setStepDraft(e.target.value)} placeholder={steps.length ? "Add another step" : "First step, e.g. Call every lead due today"}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addStep(); } }} maxLength={200} aria-label="New step" />
                  <Button type="button" variant="outline" onClick={addStep} disabled={!stepDraft.trim()}><Plus className="h-4 w-4" />Add</Button>
                </div>
                <p className="text-xs text-muted-foreground">Optional. Steps become the checklist they tick; progress is steps done.</p>
              </>
            )}
          </div>

          <div className="space-y-3 rounded-xl border border-border p-3">
            <label className="flex items-start justify-between gap-3">
              <span><span className="block text-sm font-medium">Needs approval</span><span className="block text-xs text-muted-foreground">&quot;Done&quot; goes to HR to approve or send back. Off for routine tasks.</span></span>
              <Switch checked={needsApproval} onCheckedChange={setNeedsApproval} aria-label="Needs approval" />
            </label>
            <label className="flex items-start justify-between gap-3">
              <span><span className="block text-sm font-medium">Proof required</span><span className="block text-xs text-muted-foreground">They must attach a photo or file when marking it done.</span></span>
              <Switch checked={proofRequired} onCheckedChange={setProofRequired} aria-label="Proof required" />
            </label>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <ResponsiveDialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Save changes" : people.length + depts.length > 1 || depts.length ? "Assign to all" : "Assign task"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
