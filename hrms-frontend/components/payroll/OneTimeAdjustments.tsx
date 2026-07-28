"use client";
import { useState } from "react";
import { Plus, Pencil, Trash2, Loader2, Coins } from "lucide-react";
import { useOneTimeAdjustments, useDeleteOneTime } from "@/hooks/useOneTimeAdjustments";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OneTimeDialog } from "@/components/payroll/OneTimeDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { getInitials, cn } from "@/lib/utils";
import { ONE_TIME_KIND_LABELS, type OneTimeAdjustment, type OneTimeKind } from "@/types";

const ALL = "__all__";
const curMonth = () => new Date().toISOString().slice(0, 7);
const empOf = (a: OneTimeAdjustment) => (a.employee && typeof a.employee === "object" ? a.employee : null);
const money = (n: number, c?: string) => `${c ? c + " " : ""}${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function OneTimeAdjustments() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("payroll", "create");
  const canEdit = hasPermission("payroll", "edit");
  const canDelete = hasPermission("payroll", "delete");

  const [month, setMonth] = useState(curMonth());
  const [kind, setKind] = useState<string>(ALL);
  const params: Record<string, string> = { month, limit: "200" };
  if (kind !== ALL) params.kind = kind;
  const { data, isLoading, isFetching } = useOneTimeAdjustments(params);
  const rows = (data?.data ?? []) as OneTimeAdjustment[];
  const { mutate: remove, isPending: deleting } = useDeleteOneTime();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<OneTimeAdjustment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OneTimeAdjustment | null>(null);

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Month</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-[160px]" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {(Object.keys(ONE_TIME_KIND_LABELS) as OneTimeKind[]).map((k) => <SelectItem key={k} value={k}>{ONE_TIME_KIND_LABELS[k]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        {canCreate && <Button onClick={() => { setSelected(null); setDialogOpen(true); }} className="shadow-sm"><Plus className="h-4 w-4" />New Adjustment</Button>}
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Label</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading || isFetching ? (
                <tr><td colSpan={6} className="py-14 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="py-14 text-center text-muted-foreground"><Coins className="mx-auto mb-2 h-7 w-7" />No one-time adjustments for this month.</td></tr>
              ) : rows.map((a) => {
                const e = empOf(a);
                return (
                  <tr key={a._id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{getInitials(e?.name ?? "?")}</div>
                        <div className="min-w-0"><p className="truncate font-medium">{e?.name ?? "—"}</p><p className="truncate text-xs text-muted-foreground">{e?.employeeCode ?? ""}</p></div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", a.kind === "payment" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600" : "border-red-500/20 bg-red-500/10 text-red-600")}>
                        {ONE_TIME_KIND_LABELS[a.kind]}
                      </span>
                    </td>
                    <td className="px-4 py-3">{a.label}</td>
                    <td className={cn("px-4 py-3 text-right font-medium tabular-nums", a.kind === "payment" ? "text-emerald-600" : "text-red-600")}>
                      {a.kind === "payment" ? "+" : "−"}{money(a.amount, e?.currency)}
                    </td>
                    <td className="px-4 py-3">
                      {a.applied
                        ? <span className="inline-flex items-center rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-600">Applied</span>
                        : <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600">Pending</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!a.applied && (
                        <div className="flex items-center justify-end gap-1">
                          {canEdit && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setSelected(a); setDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button>}
                          {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(a)}><Trash2 className="h-4 w-4" /></Button>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <OneTimeDialog open={dialogOpen} onOpenChange={setDialogOpen} adjustment={selected} defaultMonth={month} />
      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete adjustment" description="This one-time adjustment will be permanently removed." isPending={deleting}
        onConfirm={() => deleteTarget && remove(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) })}
      />
    </div>
  );
}
