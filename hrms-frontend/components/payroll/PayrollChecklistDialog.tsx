"use client";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Play, Trash2, ExternalLink, Plus, ChevronDown, ChevronUp } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { usePayrollChecklist, useCreateChecklistItem, useDeleteChecklistItem } from "@/hooks/usePayrollChecklist";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

type ItemState = "pending" | "done" | "ignored";
const VISIBLE = 5;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingCount: number;
  processing: boolean;
  onProcess: () => void;
}

export function PayrollChecklistDialog({ open, onOpenChange, pendingCount, processing, onProcess }: Props) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("payroll", "edit");
  const { data: items = [], isLoading } = usePayrollChecklist(open);
  const { mutate: addItem, isPending: adding } = useCreateChecklistItem();
  const { mutate: removeItem } = useDeleteChecklistItem();

  const [state, setState] = useState<Record<string, ItemState>>({});
  const [showAll, setShowAll] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [link, setLink] = useState("");

  // Reset the review state each time the dialog opens or the items change.
  useEffect(() => {
    if (!open) return;
    setState(Object.fromEntries(items.map((i) => [i._id, "pending" as ItemState])));
    setShowAll(false);
    setAddOpen(false); setLabel(""); setLink("");
  }, [open, items]);

  const allCleared = items.length > 0 && items.every((i) => state[i._id] && state[i._id] !== "pending");
  const shown = showAll ? items : items.slice(0, VISIBLE);

  const set = (id: string, s: ItemState) => setState((p) => ({ ...p, [id]: p[id] === s ? "pending" : s }));

  const submitAdd = () => {
    if (!label.trim()) return;
    addItem({ label: label.trim(), link: link.trim() || undefined }, { onSuccess: () => { setLabel(""); setLink(""); setAddOpen(false); } });
  };

  const processDisabled = processing || pendingCount === 0 || !allCleared;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Checklist</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="px-4 sm:px-0">
          <p className="mb-4 text-sm text-muted-foreground">Review each item before processing payroll. Check it off or ignore it.</p>

          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="divide-y divide-border/60">
              {shown.map((i) => {
                const s = state[i._id] ?? "pending";
                return (
                  <div key={i._id} className={cn("group flex items-center gap-3 py-2.5", s === "ignored" && "opacity-50")}>
                    <Checkbox checked={s === "done"} onCheckedChange={() => set(i._id, "done")} />
                    <span className={cn("flex-1 text-sm", s === "ignored" && "line-through", s === "done" && "text-muted-foreground")}>{i.label}</span>
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => set(i._id, "ignored")}>
                        {s === "ignored" ? "ignored" : "ignore this"}
                      </Button>
                      {i.link && (
                        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={() => window.open(i.link!, "_blank")}>
                          take me there <ExternalLink className="h-3 w-3" />
                        </Button>
                      )}
                      {canManage && (
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeItem(i._id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {items.length > VISIBLE && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              {showAll ? <>less <ChevronUp className="h-3 w-3" /></> : <>more <ChevronDown className="h-3 w-3" /></>}
            </button>
          )}

          {canManage && (
            addOpen ? (
              <div className="mt-3 flex items-end gap-2 rounded-lg border border-border p-2">
                <div className="flex-1"><Input placeholder="Item label" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
                <div className="w-40"><Input placeholder="Link (optional)" value={link} onChange={(e) => setLink(e.target.value)} /></div>
                <Button type="button" size="sm" onClick={submitAdd} disabled={adding || !label.trim()}>{adding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
              </div>
            ) : (
              <button type="button" onClick={() => setAddOpen(true)} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                <Plus className="h-3.5 w-3.5" />Add item
              </button>
            )
          )}

          {!allCleared && !isLoading && items.length > 0 && (
            <p className="mt-4 text-[11px] text-amber-600">Check or ignore every item to enable Process Payroll.</p>
          )}
          {pendingCount === 0 && (
            <p className="mt-4 text-[11px] text-muted-foreground">All employees already have a payslip for this month.</p>
          )}
        </div>

        <ResponsiveDialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={onProcess} disabled={processDisabled}>
            {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Process Payroll {pendingCount > 0 ? `(${pendingCount})` : ""}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
