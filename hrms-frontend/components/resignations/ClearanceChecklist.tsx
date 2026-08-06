"use client";
import { useState } from "react";
import { Check, Loader2, Minus, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useStartClearance, useSetClearance, useUpdateClearanceItem } from "@/hooks/useResignations";
import {
  CLEARANCE_DEPARTMENTS, CLEARANCE_DEPT_LABELS,
  type ClearanceDepartment, type ClearanceItem, type Resignation,
} from "@/types";

const DEPT_TINT: Record<ClearanceDepartment, string> = {
  it: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  finance: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  hr: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  admin: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  manager: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
};

const nameOf = (v?: { name: string } | string | null) => (v && typeof v === "object" ? v.name : null);
const fmtDate = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso)) : "";

export function ClearanceChecklist({ resignation: r, canEdit }: { resignation: Resignation; canEdit: boolean }) {
  const items = r.clearance ?? [];
  const { mutate: start, isPending: starting } = useStartClearance();
  const { mutate: setClearance, isPending: saving } = useSetClearance();
  const { mutate: updateItem } = useUpdateClearanceItem();

  const [adding, setAdding] = useState(false);
  const [newDept, setNewDept] = useState<ClearanceDepartment>("it");
  const [newItem, setNewItem] = useState("");

  // "Not applicable" lines don't count against completion.
  const applicable = items.filter((i) => i.status !== "not_applicable");
  const cleared = applicable.filter((i) => i.status === "cleared").length;
  const pct = applicable.length ? Math.round((cleared / applicable.length) * 100) : 0;

  const serialise = (list: ClearanceItem[]) =>
    list.map((i) => ({ _id: i._id, department: i.department, item: i.item, status: i.status, notes: i.notes }));

  const addLine = () => {
    const text = newItem.trim();
    if (!text) return;
    setClearance(
      { id: r._id, items: [...serialise(items), { department: newDept, item: text }] },
      { onSuccess: () => { setNewItem(""); setAdding(false); } }
    );
  };

  const removeLine = (itemId: string) =>
    setClearance({ id: r._id, items: serialise(items.filter((i) => i._id !== itemId)) });

  const cycle = (i: ClearanceItem) => {
    // cleared → not applicable → pending → cleared
    const next = i.status === "pending" ? "cleared" : i.status === "cleared" ? "not_applicable" : "pending";
    updateItem({ id: r._id, itemId: i._id, data: { status: next } });
  };

  if (!items.length) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center">
        <p className="text-sm text-muted-foreground">No clearance checklist yet.</p>
        {canEdit && (
          <Button className="mt-3" size="sm" onClick={() => start(r._id)} disabled={starting}>
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Start clearance checklist
          </Button>
        )}
      </div>
    );
  }

  const byDept = CLEARANCE_DEPARTMENTS.map((d) => ({ dept: d, rows: items.filter((i) => i.department === d) })).filter((g) => g.rows.length);

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", pct === 100 ? "bg-emerald-500" : "bg-primary")}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-sm font-semibold tabular-nums">{cleared}/{applicable.length}</span>
        {pct === 100 && <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">Fully cleared</Badge>}
      </div>

      {byDept.map(({ dept, rows }) => (
        <div key={dept} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", DEPT_TINT[dept])}>
              {CLEARANCE_DEPT_LABELS[dept]}
            </span>
          </div>
          {rows.map((i) => (
            <div key={i._id} className="flex items-start gap-3 rounded-lg border border-border p-2.5">
              <button
                type="button"
                onClick={() => canEdit && cycle(i)}
                disabled={!canEdit}
                aria-label={`Mark "${i.item}" — currently ${i.status.replace("_", " ")}`}
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
                  i.status === "cleared" && "border-emerald-500 bg-emerald-500 text-white",
                  i.status === "not_applicable" && "border-muted-foreground/40 bg-muted text-muted-foreground",
                  i.status === "pending" && "border-border hover:border-primary",
                  !canEdit && "cursor-default opacity-70"
                )}
              >
                {i.status === "cleared" && <Check className="h-3.5 w-3.5" />}
                {i.status === "not_applicable" && <Minus className="h-3.5 w-3.5" />}
              </button>

              <div className="min-w-0 flex-1">
                <p className={cn("text-sm", i.status === "cleared" && "text-muted-foreground line-through")}>{i.item}</p>
                {i.status !== "pending" && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {i.status === "not_applicable" ? "Not applicable" : "Cleared"}
                    {nameOf(i.clearedBy) ? ` by ${nameOf(i.clearedBy)}` : ""}
                    {i.clearedAt ? ` · ${fmtDate(i.clearedAt)}` : ""}
                  </p>
                )}
                {i.notes && <p className="mt-0.5 text-xs text-muted-foreground">{i.notes}</p>}
              </div>

              {canEdit && (
                <div className="flex shrink-0 items-center gap-1">
                  {i.status !== "pending" && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" title="Reopen"
                      onClick={() => updateItem({ id: r._id, itemId: i._id, data: { status: "pending" } })}>
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" title="Remove"
                    onClick={() => removeLine(i._id)} disabled={saving}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      {canEdit && (adding ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-2.5">
          <Select value={newDept} onValueChange={(v) => setNewDept(v as ClearanceDepartment)}>
            <SelectTrigger className="h-9 w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CLEARANCE_DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{CLEARANCE_DEPT_LABELS[d]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            className="h-9 min-w-[200px] flex-1"
            placeholder="What needs clearing?"
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLine(); } }}
            autoFocus
          />
          <Button size="sm" onClick={addLine} disabled={saving || !newItem.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewItem(""); }}>Cancel</Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" />Add item
        </Button>
      ))}
    </div>
  );
}
