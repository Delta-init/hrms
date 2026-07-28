"use client";
import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Save, CheckCircle2, Printer, Plus, Trash2, Lock } from "lucide-react";
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogHeader,
  ResponsiveDialogTitle, ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { usePreviewSettlement, useSaveSettlement, useFinaliseSettlement } from "@/hooks/useResignations";
import { useAuth } from "@/hooks/useAuth";
import { printSettlement } from "@/components/resignations/printSettlement";
import type { Resignation, FinalSettlement, SettlementLine } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resignation: Resignation;
}

const empOf = (r: Resignation) => (r.employee && typeof r.employee === "object" ? r.employee : null);

export function SettlementDialog({ open, onOpenChange, resignation: r }: Props) {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("resignations", "edit");
  const canApprove = hasPermission("resignations", "approve");

  const { mutate: preview, isPending: previewing } = usePreviewSettlement();
  const { mutate: save, isPending: saving } = useSaveSettlement();
  const { mutate: finalise, isPending: finalising } = useFinaliseSettlement();

  const [result, setResult] = useState<FinalSettlement | null>(null);
  const [leaveDays, setLeaveDays] = useState("0");
  const [noticeDays, setNoticeDays] = useState("0");
  const [gratuityOverride, setGratuityOverride] = useState("");
  const [notes, setNotes] = useState("");
  const [extraEarnings, setExtraEarnings] = useState<SettlementLine[]>([]);
  const [extraDeductions, setExtraDeductions] = useState<SettlementLine[]>([]);
  const [confirmSettle, setConfirmSettle] = useState(false);

  const settled = !!result?.settled || !!r.settlement?.settled;
  const readOnly = settled || !canEdit;

  const buildInput = () => ({
    leaveEncashmentDays: Number(leaveDays) || 0,
    noticeShortfallDays: Number(noticeDays) || 0,
    gratuityOverride: gratuityOverride === "" ? null : Number(gratuityOverride),
    extraEarnings: extraEarnings.filter((l) => l.label.trim() && l.amount),
    extraDeductions: extraDeductions.filter((l) => l.label.trim() && l.amount),
    notes: notes || undefined,
  });

  // Seed inputs from a saved settlement (if any), then compute on open.
  useEffect(() => {
    if (!open) return;
    const s = r.settlement;
    setLeaveDays(s ? String(s.leaveEncashmentDays ?? 0) : "0");
    setNoticeDays(s ? String(s.noticeShortfallDays ?? 0) : "0");
    setGratuityOverride("");
    setNotes(s?.notes ?? "");
    setExtraEarnings([]);
    setExtraDeductions([]);
    setResult(s ?? null);
    // Fresh compute reflecting current dues.
    preview({ id: r._id, data: s ? { leaveEncashmentDays: s.leaveEncashmentDays, noticeShortfallDays: s.noticeShortfallDays, notes: s.notes ?? undefined } : {} }, { onSuccess: setResult });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, r._id]);

  const recalc = () => preview({ id: r._id, data: buildInput() }, { onSuccess: setResult });
  const onSave = () => save({ id: r._id, data: buildInput() }, { onSuccess: setResult });
  const onFinalise = () => finalise(r._id, { onSuccess: (s) => { setResult(s); setConfirmSettle(false); } });

  const emp = empOf(r);
  const cur = result?.currency ?? "AED";
  const money = (n: number) => `${cur} ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const addLine = (which: "e" | "d") => {
    const line = { label: "", amount: 0 };
    if (which === "e") setExtraEarnings((v) => [...v, line]); else setExtraDeductions((v) => [...v, line]);
  };
  const setLine = (which: "e" | "d", i: number, patch: Partial<SettlementLine>) => {
    const upd = (v: SettlementLine[]) => v.map((l, idx) => (idx === i ? { ...l, ...patch } : l));
    if (which === "e") setExtraEarnings(upd); else setExtraDeductions(upd);
  };
  const rmLine = (which: "e" | "d", i: number) => {
    const upd = (v: SettlementLine[]) => v.filter((_, idx) => idx !== i);
    if (which === "e") setExtraEarnings(upd); else setExtraDeductions(upd);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopClassName="max-w-3xl max-h-[92vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            Full &amp; Final Settlement
            {settled && <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600"><Lock className="h-3 w-3" />Settled</span>}
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-4 px-4 sm:px-0">
          <p className="text-xs text-muted-foreground">{emp?.name} · {emp?.employeeCode ?? ""} · exit {new Date(r.lastWorkingDay).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</p>

          {/* Inputs */}
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-border p-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Leave encashment (days)</Label>
              <Input type="number" min="0" step="0.5" value={leaveDays} onChange={(e) => setLeaveDays(e.target.value)} disabled={readOnly} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notice shortfall (days)</Label>
              <Input type="number" min="0" step="0.5" value={noticeDays} onChange={(e) => setNoticeDays(e.target.value)} disabled={readOnly} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Gratuity override</Label>
              <Input type="number" min="0" step="0.01" placeholder="auto" value={gratuityOverride} onChange={(e) => setGratuityOverride(e.target.value)} disabled={readOnly} />
            </div>
          </div>

          {/* Manual extra lines */}
          {!readOnly && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ExtraLines title="Extra payable" color="emerald" lines={extraEarnings} onAdd={() => addLine("e")} onSet={(i, p) => setLine("e", i, p)} onRemove={(i) => rmLine("e", i)} />
              <ExtraLines title="Extra recovery" color="red" lines={extraDeductions} onAdd={() => addLine("d")} onSet={(i, p) => setLine("d", i, p)} onRemove={(i) => rmLine("d", i)} />
            </div>
          )}

          {!readOnly && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={recalc} disabled={previewing}><RefreshCw className={`h-3.5 w-3.5 ${previewing ? "animate-spin" : ""}`} />Recalculate</Button>
              <p className="text-[11px] text-muted-foreground">Gratuity, loans, reimbursements &amp; one-time entries are pulled in automatically.</p>
            </div>
          )}

          {/* Breakdown */}
          {previewing && !result ? (
            <div className="py-10 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : result ? (
            <>
              <div className="flex flex-wrap gap-4 rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <span>Tenure <b className="text-foreground">{result.tenureYears} yrs</b></span>
                <span>Basic <b className="text-foreground">{money(result.basic)}</b></span>
                <span>Day rate <b className="text-foreground">{money(result.dayRate)}</b></span>
                <span>Gratuity <b className="text-foreground">{money(result.gratuity)}</b></span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <LineTable title="Payable" lines={result.earnings} total={result.totalEarnings} money={money} positive />
                <LineTable title="Recoveries" lines={result.deductions} total={result.totalDeductions} money={money} />
              </div>
              <div className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                <span className="font-semibold text-emerald-700">Net payable</span>
                <span className="text-xl font-bold tabular-nums text-emerald-700">{money(result.netPayable)}</span>
              </div>
            </>
          ) : null}

          {!readOnly && (
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} placeholder="Optional settlement notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          )}
        </div>

        <ResponsiveDialogFooter className="flex-wrap gap-2">
          {result && <Button variant="outline" onClick={() => printSettlement(result, emp, r.lastWorkingDay)}><Printer className="h-4 w-4" />Print statement</Button>}
          <div className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {!settled && canEdit && <Button variant="outline" onClick={onSave} disabled={saving || previewing}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save draft</Button>}
          {!settled && canApprove && <Button onClick={() => setConfirmSettle(true)} disabled={finalising || previewing}><CheckCircle2 className="h-4 w-4" />Finalise</Button>}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>

      <ConfirmDialog
        open={confirmSettle} onOpenChange={setConfirmSettle}
        title="Finalise settlement?"
        description="This locks the settlement and marks the included dues as paid — outstanding loans are closed, approved reimbursements and pending one-time entries are consumed so they won't be paid again through payroll. Save any changes first."
        confirmLabel="Finalise" isPending={finalising} onConfirm={onFinalise}
      />
    </ResponsiveDialog>
  );
}

function LineTable({ title, lines, total, money, positive }: { title: string; lines: SettlementLine[]; total: number; money: (n: number) => string; positive?: boolean }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="space-y-1.5">
        {lines.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : lines.map((l, i) => (
          <div key={i} className="flex justify-between text-sm"><span className="pr-2">{l.label}</span><span className={`tabular-nums ${positive ? "text-emerald-600" : "text-red-500"}`}>{positive ? "+" : "−"}{money(l.amount)}</span></div>
        ))}
      </div>
      <div className="mt-2 flex justify-between border-t border-border pt-2 text-sm font-semibold"><span>Total</span><span className="tabular-nums">{money(total)}</span></div>
    </div>
  );
}

function ExtraLines({ title, color, lines, onAdd, onSet, onRemove }: {
  title: string; color: "emerald" | "red"; lines: SettlementLine[];
  onAdd: () => void; onSet: (i: number, p: Partial<SettlementLine>) => void; onRemove: (i: number) => void;
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className={`text-xs font-semibold uppercase tracking-wide ${color === "emerald" ? "text-emerald-600" : "text-red-500"}`}>{title}</p>
        <Button type="button" variant="ghost" size="sm" className="h-7" onClick={onAdd}><Plus className="h-3.5 w-3.5" />Add</Button>
      </div>
      {lines.length === 0 ? <p className="text-[11px] text-muted-foreground">None</p> : (
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input className="h-8" placeholder="Label" value={l.label} onChange={(e) => onSet(i, { label: e.target.value })} />
              <Input className="h-8 w-24" type="number" min="0" step="0.01" placeholder="0" value={l.amount || ""} onChange={(e) => onSet(i, { amount: Number(e.target.value) })} />
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive" onClick={() => onRemove(i)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
