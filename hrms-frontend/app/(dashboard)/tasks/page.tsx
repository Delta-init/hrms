"use client";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarClock, CheckCircle2, ChevronDown, Paperclip, ChevronRight, ClipboardCheck, ListChecks, ListTodo, Loader2, Plus, Repeat, Send, UserRound, Users, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs } from "@/components/shared/Tabs";
import { Card } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useTasks, useTaskSummary, useTaskCategories } from "@/hooks/useTasks";
import { TaskDialog } from "@/components/tasks/TaskDialog";
import { TaskPanel } from "@/components/tasks/TaskPanel";
import { StatusPill, Progress, DueLine, PriorityText, wasSentBack, RepeatTag } from "@/components/tasks/shared";
import { SeriesList } from "@/components/tasks/SeriesList";
import { MyDayPlan } from "@/components/tasks/MyDayPlan";
import { DayPlansAdmin } from "@/components/tasks/DayPlansAdmin";
import { useMyDay, useDayPlanAccess } from "@/hooks/useDayPlans";
import { cn, getInitials } from "@/lib/utils";
import { TASK_STATUS_LABELS, type Task, type TaskStatus } from "@/types";

/*
 * Tasks (2026-11-25, Part 1). Everyone has "My tasks"; HR — the `tasks` permission — also sees what it handed out,
 * what waits on its approval, and everything. A task given to several people is one row that opens to each person.
 */

const ALL = "__all__";

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}>
      <TasksScreen />
    </Suspense>
  );
}

function TasksScreen() {
  const { hasPermission } = useAuth();
  const canView = hasPermission("tasks", "view");
  const canCreate = hasPermission("tasks", "create");
  const canApprove = hasPermission("tasks", "approve");
  const params = useSearchParams();
  const { data: dayPlanAccess = false } = useDayPlanAccess();

  const tabs = [
    { key: "mine", label: "My tasks", icon: ListTodo },
    canCreate && { key: "assigned", label: "Assigned by me", icon: Send },
    (canView || canApprove) && { key: "waiting", label: "Waiting for approval", icon: ClipboardCheck },
    canView && { key: "all", label: "All tasks", icon: ListChecks },
    canView && { key: "repeating", label: "Repeating", icon: Repeat },
    // The HR department's, not a permission (2026-11-26: "HR department only").
    dayPlanAccess && { key: "dayplans", label: "Day plans", icon: CalendarClock },
  ].filter(Boolean) as { key: string; label: string; icon: React.ElementType; count?: number }[];
  const [tab, setTab] = useState(() => params.get("tab") ?? "mine");
  const active = tabs.some((t) => t.key === tab) ? tab : "mine";

  const { data: summary } = useTaskSummary(canView);
  const waitingTab = tabs.find((t) => t.key === "waiting");
  if (waitingTab && summary?.waiting) waitingTab.count = summary.waiting;

  const [openId, setOpenId] = useState<string | null>(null);
  /** "See copies" from the Repeating tab: All tasks narrowed to one series. */
  const [seriesFilter, setSeriesFilter] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });

  return (
    <div>
      <PageHeader
        title="Tasks"
        description="Work given to people, with steps to tick and HR's approval at the end."
        icon={ListTodo}
        action={canCreate ? <Button onClick={() => setDialog({ open: true, task: null })} className="shadow-sm"><Plus className="h-4 w-4" />New task</Button> : null}
      />
      <Tabs tabs={tabs} value={active} onChange={setTab} />

      {active === "mine" ? (
        <MyTasks onOpen={setOpenId} />
      ) : active === "dayplans" ? (
        <DayPlansAdmin />
      ) : active === "repeating" ? (
        <SeriesList onShowCopies={(id) => { setSeriesFilter(id); setTab("all"); }} />
      ) : (
        <TeamTasks key={`${active}-${seriesFilter ?? ""}`} scope={active as "assigned" | "waiting" | "all"} showSummary={canView} summary={summary} onOpen={setOpenId}
          series={active === "all" ? seriesFilter : null} onClearSeries={() => setSeriesFilter(null)} />
      )}

      <TaskPanel taskId={openId} onOpenChange={(o) => !o && setOpenId(null)} onEdit={(t) => { setOpenId(null); setDialog({ open: true, task: t }); }} />
      <TaskDialog open={dialog.open} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} task={dialog.task} />
    </div>
  );
}

// ── My tasks ─────────────────────────────────────────────────────────────────

function MyTasks({ onOpen }: { onOpen: (id: string) => void }) {
  const { data: days = [] } = useMyDay();
  const { data, isLoading } = useTasks({ scope: "mine", limit: "200" });
  const [showDone, setShowDone] = useState(false);
  const groups = useMemo(() => {
    const rows = data?.data ?? [];
    const now = new Date();
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const endOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
    const working = rows.filter((t) => t.status === "todo" || t.status === "in_progress");
    return [
      { key: "back", label: "Sent back", tone: "bad", rows: working.filter(wasSentBack) },
      { key: "late", label: "Overdue", tone: "bad", rows: working.filter((t) => !wasSentBack(t) && t.overdue) },
      { key: "today", label: "Today", tone: "warn", rows: working.filter((t) => !wasSentBack(t) && !t.overdue && new Date(t.dueAt) < endOfToday) },
      { key: "week", label: "This week", tone: "plain", rows: working.filter((t) => !wasSentBack(t) && !t.overdue && new Date(t.dueAt) >= endOfToday && new Date(t.dueAt) < endOfWeek) },
      { key: "later", label: "Later", tone: "plain", rows: working.filter((t) => !wasSentBack(t) && new Date(t.dueAt) >= endOfWeek) },
      { key: "waiting", label: "Waiting for approval", tone: "plain", rows: rows.filter((t) => t.status === "submitted") },
      { key: "done", label: "Done", tone: "plain", rows: rows.filter((t) => t.status === "done") },
    ];
  }, [data]);

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const anything = groups.some((g) => g.key !== "done" && g.rows.length);
  // Someone with a day plan sees their day by the clock first; one-off tasks follow below.
  if (days.length) {
    return (
      <div className="space-y-8">
        {days.map((d) => <MyDayPlan key={d._id} day={d} />)}
        {anything && <div className="mx-auto max-w-2xl"><h2 className="mb-3 text-sm font-semibold text-muted-foreground">Other tasks</h2><TaskGroups groups={groups} showDone={showDone} setShowDone={setShowDone} onOpen={onOpen} /></div>}
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {!anything && (
        <Card className="py-14 text-center">
          <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
          <p className="font-medium">Nothing to do right now</p>
          <p className="text-sm text-muted-foreground">Tasks HR gives you will appear here, with a notice when they arrive.</p>
        </Card>
      )}
      <TaskGroups groups={groups} showDone={showDone} setShowDone={setShowDone} onOpen={onOpen} />
    </div>
  );
}

type Group = { key: string; label: string; tone: string; rows: Task[] };
function TaskGroups({ groups, showDone, setShowDone, onOpen }: { groups: Group[]; showDone: boolean; setShowDone: (f: (v: boolean) => boolean) => void; onOpen: (id: string) => void }) {
  const done = groups.find((g) => g.key === "done")!;
  return (
    <div className="space-y-6">
      {groups.filter((g) => g.key !== "done" && g.rows.length).map((g) => (
        <section key={g.key} className="space-y-2">
          <h2 className={cn("flex items-center justify-between text-[11px] font-bold uppercase tracking-wider",
            g.tone === "bad" ? "text-red-600 dark:text-red-400" : g.tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
            <span>{g.label}</span><span className="tabular-nums">{g.rows.length}</span>
          </h2>
          {g.rows.map((t) => <MyTaskCard key={t._id} task={t} onOpen={onOpen} />)}
        </section>
      ))}
      {done.rows.length > 0 && (
        <section className="space-y-2">
          <button type="button" onClick={() => setShowDone((v) => !v)} className="flex w-full items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <span className="flex items-center gap-1">{showDone ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}Done</span>
            <span className="tabular-nums">{done.rows.length}</span>
          </button>
          {showDone && done.rows.map((t) => <MyTaskCard key={t._id} task={t} onOpen={onOpen} />)}
        </section>
      )}
    </div>
  );
}

function MyTaskCard({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const back = wasSentBack(task);
  return (
    <button type="button" onClick={() => onOpen(task._id)}
      className={cn("w-full rounded-2xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40",
        back ? "border-red-500/40" : "border-border", task.status === "done" && "opacity-70")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium leading-snug">{task.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {task.category && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{task.category.name}</span>}
            <DueLine task={task} />
            <PriorityText p={task.priority} />
            <RepeatTag task={task} />
            <DocCount task={task} />
          </div>
        </div>
        <StatusPill task={task} />
      </div>
      {back && task.reviews.at(-1)?.note && (
        <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">HR: “{task.reviews.at(-1)!.note}”</p>
      )}
      {task.progress.total > 0 && task.status !== "done" && <div className="mt-3"><Progress task={task} wide /></div>}
    </button>
  );
}

// ── HR's views ───────────────────────────────────────────────────────────────

function TeamTasks({ scope, showSummary, summary, onOpen, series = null, onClearSeries }: {
  scope: "assigned" | "waiting" | "all";
  showSummary: boolean;
  summary?: { dueToday: number; overdue: number; waiting: number; onTimeRate: number | null };
  onOpen: (id: string) => void;
  series?: string | null;
  onClearSeries?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  const [status, setStatus] = useState(scope === "waiting" ? "submitted" : series ? ALL : "open");
  const { data: categories = [] } = useTaskCategories();

  const query: Record<string, string> = { scope: scope === "assigned" ? "assigned_by_me" : scope === "waiting" ? "waiting" : "all", limit: "200" };
  if (search.trim()) query.search = search.trim();
  if (category !== ALL) query.category = category;
  if (series) query.series = series;
  if (scope !== "waiting") {
    if (status === "open") query.open = "true";
    else if (status === "overdue") query.overdue = "true";
    else if (status !== ALL) query.status = status;
  }
  const { data, isLoading, isFetching } = useTasks(query);
  // One row per batch — a task given to nine people is one line with nine inside.
  const batches = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of data?.data ?? []) map.set(t.batch, [...(map.get(t.batch) ?? []), t]);
    return Array.from(map.values());
  }, [data]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-4">
      {showSummary && summary && scope !== "waiting" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Due today" value={summary.dueToday} />
          <Stat label="Overdue" value={summary.overdue} tone={summary.overdue ? "bad" : undefined} />
          <Stat label="Waiting for approval" value={summary.waiting} tone={summary.waiting ? "warn" : undefined} />
          <Stat label="Done on time, this month" value={summary.onTimeRate == null ? "—" : `${summary.onTimeRate}%`} />
        </div>
      )}

      {series && (
        <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <Repeat className="h-4 w-4 text-primary" />Copies made by one repeating task
          <button type="button" onClick={onClearSeries} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"><X className="h-3 w-3" />Show all</button>
        </div>
      )}
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <Input placeholder="Search tasks or people…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 min-w-[200px] flex-1" />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-9 w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {categories.map((c) => <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {scope !== "waiting" && (
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Not finished</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              {(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).map((k) => <SelectItem key={k} value={k}>{TASK_STATUS_LABELS[k]}</SelectItem>)}
              <SelectItem value={ALL}>Everything</SelectItem>
            </SelectContent>
          </Select>
        )}
      </Card>

      {isLoading || isFetching ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : !batches.length ? (
        <Card className="py-14 text-center text-sm text-muted-foreground">
          <ListTodo className="mx-auto mb-2 h-7 w-7" />
          {scope === "waiting" ? "Nothing is waiting for your approval." : "No tasks match these filters."}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Task</th>
                  <th className="px-4 py-3 font-medium">Assigned to</th>
                  <th className="px-4 py-3 font-medium">Progress</th>
                  <th className="px-4 py-3 font-medium">Documents</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((group) => {
                  const first = group[0];
                  if (group.length === 1) return <TaskRow key={first._id} task={first} onOpen={onOpen} />;
                  const open = !!expanded[first.batch];
                  const doneCount = group.filter((t) => t.status === "done").length;
                  const waiting = group.filter((t) => t.status === "submitted").length;
                  const late = group.filter((t) => t.overdue).length;
                  return (
                    <GroupRows key={first.batch} group={group} open={open}
                      onToggle={() => setExpanded((e) => ({ ...e, [first.batch]: !open }))} onOpen={onOpen}
                      doneCount={doneCount} waiting={waiting} late={late} />
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "bad" | "warn" }) {
  return (
    <Card className="p-3">
      <p className={cn("text-2xl font-semibold tabular-nums", tone === "bad" && "text-red-600 dark:text-red-400", tone === "warn" && "text-amber-600 dark:text-amber-400")}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Card>
  );
}

function TitleCell({ task }: { task: Task }) {
  return (
    <>
      <p className="font-medium">{task.title}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-2">
        {task.category && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{task.category.name}</span>}
        <PriorityText p={task.priority} />
        <RepeatTag task={task} />
        {!task.needsApproval && <span className="text-[11px] text-muted-foreground">No approval</span>}
      </div>
    </>
  );
}

/** 📎 What was handed in, and HR's own files, without opening the task (2026-11-26). */
function DocCount({ task }: { task: Task }) {
  const handedIn = task.submission?.files?.length ?? (task.submission?.fileName ? 1 : 0);
  const fromHr = task.attachments?.length ?? 0;
  if (!handedIn && !fromHr) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" title={[handedIn && `${handedIn} handed in`, fromHr && `${fromHr} from HR`].filter(Boolean).join(" · ")}>
      <Paperclip className="h-3 w-3" />{handedIn ? <span className="font-medium text-foreground">{handedIn} handed in</span> : null}{handedIn && fromHr ? " · " : ""}{fromHr ? `${fromHr} from HR` : ""}
    </span>
  );
}

/**
 * The Documents column (2026-11-26): how many files were handed in and how many HR attached, and the files
 * themselves on a click — without opening the task. For a task given to several people, everyone's, by person.
 */
function DocsCell({ tasks }: { tasks: Task[] }) {
  const handedIn = (t: Task) => t.submission?.files?.length ? t.submission.files : t.submission?.fileName ? [{ name: t.submission.fileName, url: t.submission.fileUrl, at: t.submission.at }] : [];
  const fromHr = tasks[0]?.attachments ?? [];
  const people = tasks.map((t) => ({ t, files: handedIn(t) })).filter((x) => x.files.length);
  const total = people.reduce((n, x) => n + x.files.length, 0);
  if (!total && !fromHr.length) return <span className="text-xs text-muted-foreground">—</span>;
  const link = (f: { name: string; url: string }, i: number) => (
    <li key={`${f.url}-${i}`}>
      <a href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded px-1.5 py-1 text-sm text-primary hover:bg-muted">
        <Paperclip className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 truncate">{f.name}</span>
      </a>
    </li>
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs hover:border-primary/40 hover:bg-muted/50">
          <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
          {total > 0 && <span className="font-medium">{total} handed in</span>}
          {total > 0 && fromHr.length > 0 && <span className="text-muted-foreground">·</span>}
          {fromHr.length > 0 && <span className="text-muted-foreground">{fromHr.length} from HR</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3 p-3" onClick={(e) => e.stopPropagation()}>
        {people.map(({ t, files }) => (
          <div key={t._id}>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{tasks.length > 1 ? `${t.assignee?.name ?? "—"} · ` : ""}Handed in ({files.length})</p>
            <ul>{files.map(link)}</ul>
          </div>
        ))}
        {fromHr.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">From HR ({fromHr.length})</p>
            <ul>{fromHr.map(link)}</ul>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Person({ name }: { name?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">{getInitials(name ?? "?")}</span>
      <span className="truncate">{name ?? "—"}</span>
    </span>
  );
}

function TaskRow({ task, onOpen, nested = false }: { task: Task; onOpen: (id: string) => void; nested?: boolean }) {
  return (
    <tr className={cn("cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/30", nested && "bg-muted/20")} onClick={() => onOpen(task._id)}>
      <td className={cn("px-4 py-3", nested && "pl-10")}>{nested ? <span className="text-xs text-muted-foreground">{task.assignee?.name}&apos;s copy</span> : <TitleCell task={task} />}</td>
      <td className="px-4 py-3"><Person name={task.assignee?.name} /></td>
      <td className="px-4 py-3"><Progress task={task} /></td>
      <td className="px-4 py-3"><DocsCell tasks={[task]} /></td>
      <td className="px-4 py-3"><DueLine task={task} /></td>
      <td className="px-4 py-3"><StatusPill task={task} /></td>
    </tr>
  );
}

function GroupRows({ group, open, onToggle, onOpen, doneCount, waiting, late }: {
  group: Task[]; open: boolean; onToggle: () => void; onOpen: (id: string) => void; doneCount: number; waiting: number; late: number;
}) {
  const first = group[0];
  return (
    <>
      <tr className="cursor-pointer border-b border-border/60 hover:bg-muted/30" onClick={onToggle} aria-expanded={open}>
        <td className="px-4 py-3">
          <div className="flex items-start gap-2">
            {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
            <div className="min-w-0"><TitleCell task={first} /></div>
          </div>
        </td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground">{first.viaDepartment ? <Users className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}</span>
            <span>{group.length} people{first.viaDepartment ? <span className="block text-xs text-muted-foreground">{first.viaDepartment.name}</span> : null}</span>
          </span>
        </td>
        <td className="px-4 py-3">
          <span className="inline-flex items-center gap-2">
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${Math.round((doneCount / group.length) * 100)}%` }} /></span>
            <span className="text-xs tabular-nums text-muted-foreground">{doneCount}/{group.length} done</span>
          </span>
        </td>
        <td className="px-4 py-3"><DocsCell tasks={group} /></td>
        <td className="px-4 py-3"><DueLine task={first} /></td>
        <td className="px-4 py-3 text-xs">
          {waiting > 0 && <span className="mr-2 font-medium text-amber-600 dark:text-amber-400">{waiting} waiting</span>}
          {late > 0 && <span className="font-medium text-red-600 dark:text-red-400">{late} overdue</span>}
          {!waiting && !late && <span className="text-muted-foreground">{doneCount === group.length ? "All done" : "In progress"}</span>}
        </td>
      </tr>
      {open && group.map((t) => <TaskRow key={t._id} task={t} onOpen={onOpen} nested />)}
    </>
  );
}
