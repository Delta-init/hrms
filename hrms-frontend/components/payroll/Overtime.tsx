"use client";
import { useState } from "react";
import { Plus, Pencil, Trash2, Loader2, Timer } from "lucide-react";
import { useOvertime, useDeleteOvertime } from "@/hooks/useOvertime";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OvertimeDialog } from "@/components/payroll/OvertimeDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { getInitials, cn } from "@/lib/utils";
import type { Overtime as OvertimeType } from "@/types";

const curMonth = () => new Date().toISOString().slice(0, 7);
const empOf = (o: OvertimeType) => (o.employee && typeof o.employee === "object" ? o.employee : null);
const money = (n: number, c?: string) => `${c ? c + " " : ""}${(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const fmtDate = (s?: string) => (s ? new Date(s).toLocaleDateString(undefined, { day: "2-digit", month: "short" }) : "—");

export function Overtime() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("payroll", "create");
  const canEdit = hasPermission("payroll", "edit");
  const canDelete = hasPermission("payroll", "delete");

  const [month, setMonth] = useState(curMonth());
  const { data, isLoading, isFetching } = useOvertime({ month, limit: "200" });
  const rows = (data?.data ?? []) as OvertimeType[];
  const { mutate: remove, isPending: deleting } = useDeleteOvertime();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<OvertimeType | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OvertimeType | null>(null);
  const total = rows.reduce((a, r) => a + r.amount, 0);

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Month</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-[160px]" />
          </div>
          <div className="text-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total overtime</p>
            <p className="font-semibold tabular-nums text-emerald-600">{money(total, rows[0] ? empOf(rows[0])?.currency : undefined)}</p>
          </div>
        </div>
        {canCreate && <Button onClick={() => { setSelected(null); setDialogOpen(true); }} className="shadow-sm"><Plus className="h-4 w-4" />Record Overtime</Button>}
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 text-right font-medium">Hours</th>
                <th className="px-4 py-3 text-right font-medium">Rate × Mult</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading || isFetching ? (
                <tr><td colSpan={7} className="py-14 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="py-14 text-center text-muted-foreground"><Timer className="mx-auto mb-2 h-7 w-7" />No overtime recorded for this month.</td></tr>
              ) : rows.map((o) => {
                const e = empOf(o);
                return (
                  <tr key={o._id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{getInitials(e?.name ?? "?")}</div>
                        <div className="min-w-0"><p className="truncate font-medium">{e?.name ?? "—"}</p><p className="truncate text-xs text-muted-foreground">{e?.employeeCode ?? ""}</p></div>
                      </div>
                    </td>
                    <td className="px-4 py-3">{fmtDate(o.date)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{o.hours}h</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{money(o.hourlyRate)} × {o.multiplier}</td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-emerald-600">{money(o.amount, e?.currency)}</td>
                    <td className="px-4 py-3">
                      {o.applied
                        ? <span className="inline-flex items-center rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-600">Paid</span>
                        : <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600">Pending</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!o.applied && (
                        <div className="flex items-center justify-end gap-1">
                          {canEdit && <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setSelected(o); setDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button>}
                          {canDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(o)}><Trash2 className="h-4 w-4" /></Button>}
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

      <OvertimeDialog open={dialogOpen} onOpenChange={setDialogOpen} overtime={selected} defaultMonth={month} />
      <ConfirmDialog
        open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete overtime" description="This overtime record will be permanently removed." isPending={deleting}
        onConfirm={() => deleteTarget && remove(deleteTarget._id, { onSuccess: () => setDeleteTarget(null) })}
      />
    </div>
  );
}
