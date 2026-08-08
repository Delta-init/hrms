"use client";
import { useState } from "react";
import { Loader2, Play, CalendarDays, Plus, Pencil, Undo2, X, Check } from "lucide-react";
import { usePayrollRun, useGeneratePayroll, usePayslip, useBulkPayslipStatus, useBulkDeletePayslips } from "@/hooks/usePayslips";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PayslipDialog } from "@/components/payroll/PayslipDialog";
import { PayrollChecklistDialog } from "@/components/payroll/PayrollChecklistDialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getInitials, cn } from "@/lib/utils";
import { PAYSLIP_STATUS_LABELS, type PayrollRunRow, type PayslipStatus } from "@/types";

const statusStyles: Record<PayslipStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  issued: "bg-sky-500/10 text-sky-600 border-sky-500/20",
  paid: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
};
const curMonth = () => new Date().toISOString().slice(0, 7);
const money = (n: number, c: string) => `${c} ${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PayrollRun() {
  const { hasPermission } = useAuth();
  const canGenerate = hasPermission("payroll", "create");
  const canEdit = hasPermission("payroll", "edit");
  const canDelete = hasPermission("payroll", "delete");
  const [month, setMonth] = useState(curMonth());
  const { data, isLoading, isFetching } = usePayrollRun(month);
  const { mutate: generate, isPending: generating } = useGeneratePayroll();

  const { mutate: bulkStatus, isPending: settingStatus } = useBulkPayslipStatus();
  const { mutate: bulkDelete, isPending: reverting } = useBulkDeletePayslips();

  const [checklistOpen, setChecklistOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [revertOpen, setRevertOpen] = useState(false);
  const [createRow, setCreateRow] = useState<PayrollRunRow | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const { data: editPayslip } = usePayslip(editId ?? undefined);

  const rows = data?.rows ?? [];
  const pending = rows.filter((r) => r.status === null).length;

  // Only generated rows can be selected — there is nothing to act on until a
  // payslip exists. Keyed by payslip id, so the set survives a refetch.
  const selectableIds = rows.map((r) => r.payslipId).filter(Boolean) as string[];
  const selectedIds = selectableIds.filter((id) => selected.has(id));
  const allSelected = selectableIds.length > 0 && selectedIds.length === selectableIds.length;
  const toggleOne = (id: string) =>
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableIds));
  const clearSelection = () => setSelected(new Set());
  const applyStatus = (status: PayslipStatus) =>
    bulkStatus({ ids: selectedIds, status }, { onSuccess: clearSelection });
  const totalNet = rows.reduce((a, r) => a + r.netPay, 0);
  const currency = rows[0]?.currency ?? "AED";

  const preset = createRow
    ? {
        employeeId: createRow.employee._id,
        month,
        currency: createRow.currency,
        earnings: createRow.earnings?.length ? createRow.earnings : [{ label: "Basic", amount: createRow.salary }],
        // Only the structure's own lines. Loss of pay, late penalties and loan
        // instalments are all derived when the payslip is created — seeding
        // them here just put a figure in an editable box that the server was
        // going to recompute anyway.
        deductions: [...(createRow.structureDeductions ?? [])],
      }
    : null;
  const closeDialog = () => { setCreateRow(null); setEditId(null); };

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Payroll month</Label>
            <Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); clearSelection(); }} className="h-9 w-[170px]" />
          </div>
          <div className="text-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Employees</p>
            <p className="font-semibold">{rows.length} · <span className="text-amber-600">{pending} pending</span></p>
          </div>
          <div className="text-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Total net pay</p>
            <p className="font-semibold tabular-nums text-primary">{money(totalNet, currency)}</p>
          </div>
        </div>
        {canGenerate && (
          <Button onClick={() => setChecklistOpen(true)} disabled={pending === 0} className="shadow-sm">
            <Play className="h-4 w-4" />Process Payroll ({pending})
          </Button>
        )}
      </Card>

      {selectedIds.length > 0 && (
        <Card className="flex flex-wrap items-center gap-2 border-primary/30 bg-primary/5 p-3">
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-2" disabled={settingStatus}>
                    {settingStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Set status
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(["draft", "issued", "paid"] as PayslipStatus[]).map((st) => (
                    <DropdownMenuItem key={st} className="cursor-pointer" onSelect={() => applyStatus(st)}>
                      {PAYSLIP_STATUS_LABELS[st]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canDelete && (
              <Button variant="outline" size="sm" className="h-8 gap-2 text-destructive" disabled={reverting} onClick={() => setRevertOpen(true)}>
                {reverting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                Back to not generated
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground" onClick={clearSelection}>
              <X className="h-3.5 w-3.5" />Clear
            </Button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-10 px-4 py-3">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    disabled={selectableIds.length === 0}
                    aria-label="Select all generated payslips"
                  />
                </th>
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 text-right font-medium">Base salary</th>
                <th className="px-4 py-3 text-right font-medium">LOP</th>
                <th className="px-4 py-3 text-right font-medium">Loan</th>
                <th className="px-4 py-3 text-right font-medium">Add-ons</th>
                <th className="px-4 py-3 text-right font-medium">Deductions</th>
                <th className="px-4 py-3 text-right font-medium">Net pay</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading || isFetching ? (
                <tr><td colSpan={10} className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="py-16 text-center text-muted-foreground"><CalendarDays className="mx-auto mb-2 h-7 w-7" />No active employees for this month.</td></tr>
              ) : rows.map((r) => (
                <Row
                  key={r.employee._id}
                  r={r}
                  canEdit={canEdit}
                  canGenerate={canGenerate}
                  canDelete={canDelete}
                  selected={!!r.payslipId && selected.has(r.payslipId)}
                  onToggle={() => r.payslipId && toggleOne(r.payslipId)}
                  onAdd={() => setCreateRow(r)}
                  onEdit={() => r.payslipId && setEditId(r.payslipId)}
                  onRevert={() => { if (r.payslipId) { setSelected(new Set([r.payslipId])); setRevertOpen(true); } }}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <PayslipDialog
        open={!!createRow || (!!editId && !!editPayslip)}
        onOpenChange={(o) => { if (!o) closeDialog(); }}
        payslip={editId ? editPayslip : null}
        preset={preset}
      />

      <ConfirmDialog
        open={revertOpen}
        onOpenChange={(o) => { if (!o) setRevertOpen(false); }}
        title={selectedIds.length > 1 ? `Revert ${selectedIds.length} payslips?` : "Back to not generated?"}
        description={
          `${selectedIds.length > 1 ? "These payslips are" : "This payslip is"} deleted and the ${selectedIds.length > 1 ? "rows go" : "row goes"} back to not generated. ` +
          "Anything collected against loans, advances and one-time adjustments is handed back, so those balances return to what they were before payroll ran. " +
          "Any payslip already issued or paid will no longer exist."
        }
        isPending={reverting}
        onConfirm={() => bulkDelete(selectedIds, { onSuccess: () => { clearSelection(); setRevertOpen(false); } })}
      />

      <PayrollChecklistDialog
        open={checklistOpen}
        onOpenChange={setChecklistOpen}
        pendingCount={pending}
        processing={generating}
        onProcess={() => generate(month, { onSuccess: () => setChecklistOpen(false) })}
      />
    </div>
  );
}

function Row({ r, canEdit, canGenerate, canDelete, selected, onToggle, onAdd, onEdit, onRevert }: {
  r: PayrollRunRow; canEdit: boolean; canGenerate: boolean; canDelete: boolean;
  selected: boolean; onToggle: () => void; onAdd: () => void; onEdit: () => void; onRevert: () => void;
}) {
  return (
    <tr className={cn("border-b border-border/60 last:border-0 hover:bg-muted/30", selected && "bg-primary/5")}>
      <td className="px-4 py-3">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          disabled={!r.payslipId}
          aria-label={`Select ${r.employee.name}`}
        />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{getInitials(r.employee.name)}</div>
          <div className="min-w-0"><p className="truncate font-medium">{r.employee.name}</p><p className="truncate text-xs text-muted-foreground">{r.employee.employeeCode}</p></div>
        </div>
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {money(r.salary, r.currency)}
        {r.structureName && <p className="text-[11px] font-normal text-muted-foreground" title="Salary structure in force">{r.structureName}</p>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-red-500">
        {/* Two different denominators used to sit side by side here — days lost
            "of 26", priced at "1/30" — which read as one sum and is two. The
            rate is shown as money instead, so the line multiplies out by eye. */}
        {r.lopAmount > 0 && (
          <div
            title={
              r.lopPerDay
                ? `${r.lopDays} day(s) × ${money(r.lopPerDay, r.currency)} (salary ÷ 30)` +
                  (r.workingDays ? ` · ${r.workingDays} working days this month` : "")
                : `${r.lopDays} day(s) lost`
            }
          >
            -{money(r.lopAmount, r.currency)}
            <span className="ml-1 text-[11px] text-muted-foreground">
              ({r.lopDays} day{r.lopDays === 1 ? "" : "s"}
              {r.lopPerDay ? ` × ${money(r.lopPerDay, r.currency)}` : ""})
            </span>
          </div>
        )}
        {r.latePenaltyAmount > 0 && <div title="Late-arrival penalty">-{money(r.latePenaltyAmount, r.currency)}<span className="ml-1 text-[11px] text-muted-foreground">({r.latePenaltyDays}d late)</span></div>}
        {r.lopAmount === 0 && r.latePenaltyAmount === 0 && <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-red-500">{r.loanTotal > 0 ? `-${money(r.loanTotal, r.currency)}` : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        {r.oneTimePayments > 0 && <span className="text-emerald-600">+{money(r.oneTimePayments, r.currency)}</span>}
        {r.oneTimePayments > 0 && r.oneTimeDeductions > 0 && <span className="text-muted-foreground"> / </span>}
        {r.oneTimeDeductions > 0 && <span className="text-red-500">-{money(r.oneTimeDeductions, r.currency)}</span>}
        {r.reimbursements > 0 && <div className="text-emerald-600" title="Approved reimbursements">+{money(r.reimbursements, r.currency)}<span className="ml-1 text-[11px] text-muted-foreground">reimb</span></div>}
        {r.overtime > 0 && <div className="text-emerald-600" title="Overtime">+{money(r.overtime, r.currency)}<span className="ml-1 text-[11px] text-muted-foreground">OT</span></div>}
        {r.oneTimePayments === 0 && r.oneTimeDeductions === 0 && r.reimbursements === 0 && r.overtime === 0 && <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-red-500">{r.totalDeductions > 0 ? `-${money(r.totalDeductions, r.currency)}` : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums text-primary">{money(r.netPay, r.currency)}</td>
      <td className="px-4 py-3">
        {r.status ? (
          <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", statusStyles[r.status])}>{PAYSLIP_STATUS_LABELS[r.status]}</span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-600">Not generated</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {r.status ? (
          <div className="flex items-center justify-end gap-1">
            {canEdit && <Button variant="outline" size="sm" onClick={onEdit}><Pencil className="h-3.5 w-3.5" />Edit</Button>}
            {/* Deleting the payslip is what puts the row back to "not
                generated" — there is no fourth status to move it to. */}
            {canDelete && (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" title="Back to not generated" onClick={onRevert}>
                <Undo2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ) : (
          canGenerate && <Button variant="outline" size="sm" onClick={onAdd}><Plus className="h-3.5 w-3.5" />Add</Button>
        )}
      </td>
    </tr>
  );
}
